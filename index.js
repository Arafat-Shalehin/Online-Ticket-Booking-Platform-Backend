const express = require("express");
const cors = require("cors");
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const serviceAccount = require("./online-ticket-booking-platform-key.json");
require("dotenv").config();
const port = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

// MongoDB URL
const uri = process.env.MONGODB_URI;

// MongoDB client
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Firebase initializeApp
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("Ticket-Booking-Platform");

    const ticketsCollection = db.collection("allTickets");
    const usersCollection = db.collection("allUsers");
    const usersBookingCollection = db.collection("userBookingTickets");

    // Admin Middleware
    const verifyAdmin = async (req, res, next) => {
      try {
        const email = req.decoded_email;
        if (!email) {
          return res.status(401).send({ message: "unauthorized access" });
        }

        const user = await usersCollection.findOne({ email });
        if (!user || user.role !== "admin") {
          return res.status(403).send({ message: "forbidden" });
        }

        next();
      } catch (error) {
        console.error("verifyAdmin error:", error);
        return res.status(500).send({ message: "Internal server error" });
      }
    };

    // APIS to add user in DB
    app.get("/users/:email", async (req, res) => {
      try {
        const email = req.params.email;

        const user = await usersCollection.findOne({ email: email });

        if (!user) {
          return res.status(404).json({ message: "User not found." });
        }

        res.status(200).json(user);
      } catch (error) {
        console.error("GET /users/:email error:", error);
        res.status(500).json({ message: "Internal Server Error." });
      }
    });

    app.post("/registerUsers", async (req, res) => {
      try {
        const { name, email, photoURL } = req.body;

        if (!email) {
          return res.status(400).json({ message: "Email is required" });
        }

        // Check if user already exists
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
          return res.status(200).json(existingUser);
        }

        const newUser = {
          name,
          email,
          photoURL,
          role: "user", // default role
          createdAt: new Date(),
        };

        const result = await usersCollection.insertOne(newUser);

        // Return saved user
        // res.status(201).json({ ...newUser, _id: result.insertedId });
        const savedUser = await usersCollection.findOne({
          _id: result.insertedId,
        });
        res.status(201).json(savedUser);
      } catch (error) {
        console.error("User creation failed:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // APIS for home sections
    app.get("/sixTickets", async (req, res) => {
      try {
        const result = await ticketsCollection
          .find(
            { adminApprove: true },
            {
              projection: {
                detailsLink: 0,
                createdAt: 0,
                vendorEmail: 0,
                vendorName: 0,
                advertised: 0,
                from: 0,
                to: 0,
                departureTime: 0,
              },
            }
          )
          .limit(6)
          .toArray();

        // If no tickets found
        if (!result.length) {
          return res.status(404).json({
            message: "No admin-approved tickets found.",
          });
        }

        return res.status(200).json(result);
      } catch (error) {
        console.error("Error fetching six tickets:", error);

        return res.status(500).json({
          message: "Internal server error.",
          error: error.message,
        });
      }
    });

    app.get("/latestTickets", async (req, res) => {
      try {
        const result = await ticketsCollection
          .find(
            { adminApprove: true },
            {
              projection: {
                detailsLink: 0,
                vendorEmail: 0,
                vendorName: 0,
                advertised: 0,
                from: 0,
                to: 0,
                departureTime: 0,
              },
            }
          )
          .sort({ createdAt: -1 })
          .limit(6)
          .toArray();

        // If no tickets found
        if (!result.length) {
          return res.status(404).json({
            message: "No admin-approved tickets found.",
          });
        }

        return res.status(200).json(result);
      } catch (error) {
        console.error("Error fetching Latest tickets:", error);

        return res.status(500).json({
          message: "Internal server error.",
          error: error.message,
        });
      }
    });

    // APIS for all and specific tickets
    app.get("/allTickets", async (req, res) => {
      try {
        const result = await ticketsCollection
          .find(
            { adminApprove: true },
            {
              projection: {
                detailsLink: 0,
                vendorEmail: 0,
                vendorName: 0,
                advertised: 0,
              },
            }
          )
          .sort({ createdAt: -1 })
          .toArray();

        // If no tickets found
        if (!result.length) {
          return res.status(404).json([], {
            message: "No admin-approved tickets found.",
          });
        }

        return res.status(200).json(result);
      } catch (error) {
        console.error("Error fetching All tickets:", error);

        return res.status(500).json({
          message: "Internal server error.",
          error: error.message,
        });
      }
    });

    app.get("/ticket/:id", async (req, res) => {
      try {
        const id = req.params.id;

        // Validate ObjectId format
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid ticket ID format" });
        }

        const query = { _id: new ObjectId(id) };

        // findOne returns the document directly (NOT a cursor)
        const ticket = await ticketsCollection.findOne(query);

        if (!ticket) {
          return res.status(404).send({ message: "Ticket not found" });
        }

        res.status(200).send(ticket);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error occurred" });
      }
    });

    // APIs for Booking Tickets related
    app.post("/bookingTicket/:ticketId", async (req, res) => {
      try {
        const ticketId = req.params.ticketId;
        const { quantity, status, userName, userEmail, vendorEmail } = req.body;
        // console.log({quantity, status, userEmail});

        if (!ticketId || !quantity) {
          return res.status(400).send({
            success: false,
            message: "Ticket ID and quantity are required.",
          });
        }

        const ticket = await ticketsCollection.findOne({
          _id: new ObjectId(ticketId),
        });

        if (!ticket) {
          return res.status(404).send({
            success: false,
            message: "Ticket not found.",
          });
        }

        // Validate quantity
        if (quantity > ticket.quantity) {
          return res.status(400).send({
            success: false,
            message: `Only ${ticket.quantity} tickets available.`,
          });
        }

        // Build booking document
        const bookingData = {
          image: ticket.image,
          ticketId: ticket._id,
          userName,
          userEmail,
          vendorEmail,
          title: ticket.title,
          unitPrice: ticket.price,
          bookedQuantity: quantity,
          totalPrice: ticket.price * quantity,
          from: ticket.from,
          to: ticket.to,
          departureTime: ticket.departureTime,
          status: (status || "pending").toLowerCase(),
          createdAt: new Date(),
          paymentIntentId: null, // will be added after Stripe payment
        };

        console.log(bookingData);

        // Insert booking
        const insertResult = await usersBookingCollection.insertOne(
          bookingData
        );

        return res.send({
          success: true,
          message:
            "Booking created successfully and is pending, waiting for approval.",
          bookingId: insertResult.insertedId,
        });
      } catch (error) {
        console.error("Booking error:", error);

        return res.status(500).send({
          success: false,
          message: "Internal server error while booking ticket.",
        });
      }
    });

    app.get("/bookedTickets", async (req, res) => {
      try {
        const { email, status } = req.query;
        // console.log({ email, status });

        // Build dynamic filter
        const filter = {};
        if (email) filter.userEmail = email;
        if (status) filter.status = status;

        // Fetch bookings
        const cursor = usersBookingCollection.find(filter);
        const tickets = await cursor.toArray();
        // console.log(tickets);

        // Respond
        return res.status(200).send(tickets);
      } catch (error) {
        console.error("Error fetching booked tickets:", error);

        return res.status(500).send({
          success: false,
          message: "Internal server error while fetching booked tickets.",
        });
      }
    });

    // Vendors APIs

    // Add Tickets
    app.post("/ticket", async (req, res) => {
      try {
        const ticket = req.body;

        const departureDate = new Date(ticket.departureDateTime);

        if (isNaN(departureDate.getTime())) {
          return res.status(400).send({
            success: false,
            message: "Invalid departure date format",
          });
        }

        const doc = {
          ...ticket,
          departureDateTime: departureDate,
          verificationStatus: "pending",
          createdAt: new Date(),
        };

        const result = await ticketsCollection.insertOne(doc);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to add ticket" });
      }
    });

    // Vendor added Tickets
    app.get("/tickets/vendor", async (req, res) => {
      try {
        const emailFromQuery = req.query.email;

        // Security: vendor can only see their own tickets
        const vendorEmail = emailFromQuery;
        if (!vendorEmail) {
          return res.status(400).send({ message: "Vendor email is required" });
        }

        const cursor = ticketsCollection
          .find({ vendorEmail })
          .sort({ createdAt: -1 }); // optional sorting
        const tickets = await cursor.toArray();

        res.send(tickets);
      } catch (error) {
        console.error("Error fetching vendor tickets:", error);
        res.status(500).send({ message: "Failed to fetch tickets" });
      }
    });

    // Vendor Delete Tickets
    app.delete("/tickets/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const vendorEmail = req.decoded_email;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid ticket id" });
        }

        const query = { _id: new ObjectId(id) };
        const ticket = await ticketsCollection.findOne(query);

        if (!ticket) {
          return res.status(404).send({ message: "Ticket not found" });
        }

        // Ownership check: vendor can only delete their own ticket
        if (ticket.vendorEmail !== vendorEmail) {
          return res
            .status(403)
            .send({ message: "You can only delete your own tickets" });
        }

        // Optional (to match your UI rule strictly): block delete if rejected
        if (ticket.verificationStatus === "rejected") {
          return res
            .status(400)
            .send({ message: "Rejected tickets cannot be deleted" });
        }

        const result = await ticketsCollection.deleteOne(query);

        res.send({ data: result, deletedCount: result.deletedCount });
      } catch (error) {
        console.error("Error deleting ticket:", error);
        res.status(500).send({ message: "Failed to delete ticket" });
      }
    });

    // Vendor Update Tickets
    app.patch("/tickets/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const vendorEmail = req.decoded_email;
        const updates = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid ticket id" });
        }

        const query = { _id: new ObjectId(id) };
        const ticket = await ticketsCollection.findOne(query);

        if (!ticket) {
          return res.status(404).send({ message: "Ticket not found" });
        }

        // Ownership check
        if (ticket.vendorEmail !== vendorEmail) {
          return res
            .status(403)
            .send({ message: "You can only update your own tickets" });
        }

        if (ticket.verificationStatus === "rejected") {
          return res
            .status(400)
            .send({ message: "Rejected tickets cannot be updated" });
        }

        // Won't let vendor change protected fields.
        delete updates.vendorEmail;
        delete updates.vendorName;
        delete updates.verificationStatus;
        delete updates.isAdvertised;
        delete updates.isHiddenForFraud;

        const updateDoc = {
          $set: {
            ...updates,
            updatedAt: new Date(),
          },
        };

        const result = await ticketsCollection.updateOne(query, updateDoc);

        res.send(result);
      } catch (error) {
        console.error("Error updating ticket:", error);
        res.status(500).send({ message: "Failed to update ticket" });
      }
    });

    // Vendor Own Ticket Booking request
    app.get("/bookings/vendor", verifyFBToken, async (req, res) => {
      try {
        const emailFromQuery = req.query.email;
        const emailFromToken = req.decoded_email;

        // console.log({ emailFromQuery, emailFromToken });

        const vendorEmail = emailFromQuery || emailFromToken;
        if (!vendorEmail) {
          return res.status(400).send({ message: "Vendor email is required" });
        }

        if (emailFromQuery && emailFromQuery !== emailFromToken) {
          return res.status(403).send({ message: "forbidden" });
        }

        // Only pending booking requests
        const query = { vendorEmail, status: "pending" };
        const cursor = usersBookingCollection
          .find(query)
          .sort({ createdAt: -1 }); // newest first

        const bookings = await cursor.toArray();
        console.log(bookings);
        res.send(bookings);
      } catch (error) {
        console.error("Error fetching vendor bookings:", error);
        res.status(500).send({ message: "Failed to fetch bookings" });
      }
    });

    app.patch("/bookings/:id/accept", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const vendorEmail = req.decoded_email;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid booking id" });
        }

        const query = { _id: new ObjectId(id) };
        const booking = await usersBookingCollection.findOne(query);

        if (!booking) {
          return res.status(404).send({ message: "Booking not found" });
        }

        // Ownership: ensure this booking belongs to the current vendor
        if (booking.vendorEmail !== vendorEmail) {
          return res
            .status(403)
            .send({ message: "You can only manage your own bookings" });
        }

        if (booking.status !== "pending") {
          return res
            .status(400)
            .send({ message: "Only pending bookings can be accepted" });
        }

        const updateDoc = {
          $set: {
            status: "accepted",
            updatedAt: new Date(),
          },
        };

        const result = await usersBookingCollection.updateOne(query, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Error accepting booking:", error);
        res.status(500).send({ message: "Failed to accept booking" });
      }
    });

    app.patch("/bookings/:id/reject", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const vendorEmail = req.decoded_email;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid booking id" });
        }

        const query = { _id: new ObjectId(id) };
        const booking = await usersBookingCollection.findOne(query);

        if (!booking) {
          return res.status(404).send({ message: "Booking not found" });
        }

        if (booking.vendorEmail !== vendorEmail) {
          return res
            .status(403)
            .send({ message: "You can only manage your own bookings" });
        }

        if (booking.status !== "pending") {
          return res
            .status(400)
            .send({ message: "Only pending bookings can be rejected" });
        }

        const updateDoc = {
          $set: {
            status: "rejected",
            updatedAt: new Date(),
          },
        };

        const result = await usersBookingCollection.updateOne(query, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Error rejecting booking:", error);
        res.status(500).send({ message: "Failed to reject booking" });
      }
    });

    // Revenue Overview for a vendor
    app.get("/stats/vendor", verifyFBToken, async (req, res) => {
      try {
        const emailFromQuery = req.query.email;
        const emailFromToken = req.decoded_email;

        const vendorEmail = emailFromQuery || emailFromToken;

        if (!vendorEmail) {
          return res.status(400).send({ message: "Vendor email is required" });
        }

        if (emailFromQuery && emailFromQuery !== emailFromToken) {
          return res.status(403).send({ message: "forbidden" });
        }

        const agg = await usersBookingCollection
          .aggregate([
            {
              $match: {
                vendorEmail,
                status: "paid", // Will work on this after implemented stripe
              },
            },
            {
              $group: {
                _id: null,
                totalRevenue: { $sum: "$totalPrice" },
                totalTicketsSold: { $sum: "$bookedQuantity" },
              },
            },
          ])
          .toArray();

        const totalRevenueRaw = agg[0]?.totalRevenue || 0;
        const totalTicketsSold = agg[0]?.totalTicketsSold || 0;

        const totalRevenue = Math.round(totalRevenueRaw * 100) / 100;

        const totalTicketsAdded = await ticketsCollection.countDocuments({
          vendorEmail,
        });

        res.send({
          totalRevenue,
          totalTicketsSold,
          totalTicketsAdded,
        });
      } catch (error) {
        console.error("Error fetching vendor stats:", error);
        res.status(500).send({ message: "Failed to fetch vendor statistics" });
      }
    });

    // Admin APIs

    // All tickets added by vendors (for admin to manage)
    app.get("/tickets/admin", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const cursor = ticketsCollection.find({}).sort({ createdAt: -1 }); // newest first

        const tickets = await cursor.toArray();
        res.send(tickets);
      } catch (error) {
        console.error("Error fetching admin tickets:", error);
        res.status(500).send({ message: "Failed to fetch tickets" });
      }
    });

    // Admin approves a ticket.
    app.patch(
      "/tickets/:id/approve",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;

          if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid ticket id" });
          }

          const query = { _id: new ObjectId(id) };
          const ticket = await ticketsCollection.findOne(query);

          if (!ticket) {
            return res.status(404).send({ message: "Ticket not found" });
          }

          const updateDoc = {
            $set: {
              adminApprove: true,
              verificationStatus: "approved",
              updatedAt: new Date(),
            },
          };

          const result = await ticketsCollection.updateOne(query, updateDoc);
          res.send(result);
        } catch (error) {
          console.error("Error approving ticket:", error);
          res.status(500).send({ message: "Failed to approve ticket" });
        }
      }
    );

    // Admin rejects a ticket.
    app.patch(
      "/tickets/:id/reject",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;

          if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid ticket id" });
          }

          const query = { _id: new ObjectId(id) };
          const ticket = await ticketsCollection.findOne(query);

          if (!ticket) {
            return res.status(404).send({ message: "Ticket not found" });
          }

          const updateDoc = {
            $set: {
              adminApprove: false,
              verificationStatus: "rejected",
              updatedAt: new Date(),
            },
          };

          const result = await ticketsCollection.updateOne(query, updateDoc);
          res.send(result);
        } catch (error) {
          console.error("Error rejecting ticket:", error);
          res.status(500).send({ message: "Failed to reject ticket" });
        }
      }
    );

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}

app.get("/", (req, res) => {
  res.send("Ticket Booking Platform is on...");
});

app.listen(port, () => {
  console.log(`Ticket Booking Platform is listening on port ${port}`);
  run().catch(console.dir);
});
