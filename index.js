const express = require("express");
const cors = require("cors");
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const port = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(cors());

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

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("Ticket-Booking-Platform");

    const ticketsCollection = db.collection("allTickets");
    const usersCollection = db.collection("allUsers");
    const usersBookingCollection = db.collection("userBookingTickets");

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
        const { quantity, status, userEmail } = req.body;
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
          ticketId: ticket._id,
          userEmail,
          title: ticket.title,
          image: ticket.image,
          unitPrice: ticket.price,
          bookedQuantity: quantity,
          totalPrice: ticket.price * quantity,
          from: ticket.from,
          to: ticket.to,
          departureTime: ticket.departureTime,
          status: status || "Pending",
          createdAt: new Date(),
          countdownEnd: ticket.departureTime,
          paymentIntentId: null, // will be added after Stripe payment
        };

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
