const express = require("express");
const cors = require("cors");
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
require("dotenv").config();
const port = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(cors());

// FB Key
// const serviceAccount = require("./online-ticket-booking-platform-key.json");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);

// Stripe Stuff
const stripe = require("stripe")(process.env.STRIPE_SECRET);

// MiddleWares
const verifyFBToken = async (req, res, next) => {
  // console.log("FB Hit");
  const token = req.headers.authorization || req.headers.Authorization;
  // console.log(token);

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    // console.log("decoded in the token", decoded);
    // console.log("Decoded email:", decoded.email);

    req.decoded_email = decoded.email;
    next();
  } catch (err) {
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
    const paymentCollection = db.collection("payments");

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

    // Vendor Middleware
    const verifyVendor = async (req, res, next) => {
      try {
        // console.log("Vendor Check Hit");
        const email = req.decoded_email;
        // console.log("Vendor email:", email);
        if (!email) {
          return res.status(401).send({ message: "unauthorized access" });
        }

        const user = await usersCollection.findOne({ email });
        if (!user || user.role !== "vendor") {
          return res.status(403).send({ message: "forbidden: not a vendor" });
        }

        if (user.isFraud) {
          return res.status(403).send({
            message: "This vendor is marked as fraud and cannot add tickets.",
          });
        }

        req.vendor = user;
        next();
      } catch (error) {
        console.error("verifyVendor error:", error);
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
            {
              adminApprove: true,
              advertised: true,
              isHiddenForFraud: { $ne: true },
            },
            {
              projection: {
                createdAt: 0,
                vendorEmail: 0,
                vendorName: 0,
                isHiddenForFraud: 0,
              },
            }
          )
          .limit(6)
          .toArray();
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
            { adminApprove: true, isHiddenForFraud: { $ne: true } },
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
            { adminApprove: true, isHiddenForFraud: { $ne: true } },
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

    // APIs for Booking Ticket
    app.post("/bookingTicket/:ticketId", verifyFBToken, async (req, res) => {
      try {
        const ticketId = req.params.ticketId;
        const { quantity, status, userName, userEmail, vendorEmail } = req.body;

        if (!ticketId || quantity == null) {
          return res.status(400).send({
            success: false,
            message: "Ticket ID and quantity are required.",
          });
        }

        if (!ObjectId.isValid(ticketId)) {
          return res.status(400).send({
            success: false,
            message: "Invalid ticket ID format.",
          });
        }

        const bookingQuantity = Number(quantity);
        if (!Number.isFinite(bookingQuantity) || bookingQuantity <= 0) {
          return res.status(400).send({
            success: false,
            message: "Quantity must be a positive number.",
          });
        }

        const ticket = await ticketsCollection.findOne({
          _id: new ObjectId(ticketId),
          verificationStatus: "approved",
          adminApprove: true,
        });

        if (!ticket) {
          return res.status(404).send({
            success: false,
            message: "Ticket not found or not available for booking.",
          });
        }

        const availableQty = ticket.ticketQuantity ?? 0;
        if (bookingQuantity > availableQty) {
          return res.status(400).send({
            success: false,
            message: `Only ${availableQty} tickets available.`,
          });
        }

        const now = new Date();
        const departure = ticket.departureDateTime;
        if (!departure || new Date(departure) <= now) {
          return res.status(400).send({
            success: false,
            message:
              "This ticket is no longer available (departure has passed).",
          });
        }

        const bookingData = {
          image: ticket.image,
          ticketId: ticket._id,
          userName,
          userEmail,
          vendorEmail,
          title: ticket.title,
          unitPrice: ticket.price,
          bookedQuantity: bookingQuantity,
          totalPrice: ticket.price * bookingQuantity,
          from: ticket.from,
          to: ticket.to,
          departureDateTime: ticket.departureDateTime,
          status: (status || "pending").toLowerCase(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };

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

    // Payment related APIS
    // Get single booking (for payment page, etc.)
    app.get("/bookings/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const userEmail = req.decoded_email;

        // console.log({ id, userEmail });

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid booking id" });
        }

        const query = { ticketId: new ObjectId(id) };
        const booking = await usersBookingCollection.findOne(query);

        if (!booking) {
          return res.status(404).send({ message: "Booking not found" });
        }

        // Ensure user can only see their own booking
        if (booking.userEmail !== userEmail) {
          return res.status(403).send({ message: "forbidden" });
        }

        res.send(booking);
      } catch (error) {
        console.error("Error fetching booking:", error);
        res.status(500).send({ message: "Failed to fetch booking" });
      }
    });

    // Payment related info
    app.post("/create-checkout-session", verifyFBToken, async (req, res) => {
      try {
        const { ticketId } = req.body;
        const userEmailFromToken = req.decoded_email;

        // console.log({ ticketId, userEmailFromToken });

        if (!ObjectId.isValid(ticketId)) {
          return res.status(400).send({ message: "Invalid booking id" });
        }

        const booking = await usersBookingCollection.findOne({
          ticketId: new ObjectId(ticketId),
        });

        if (!booking) {
          return res.status(404).send({ message: "Booking not found" });
        }

        // Security: booking must belong to current user
        if (booking.userEmail !== userEmailFromToken) {
          return res.status(403).send({ message: "forbidden" });
        }

        // Only accepted bookings can be paid
        if (booking.status !== "accepted") {
          return res.status(400).send({
            message: "Only accepted bookings can be paid.",
          });
        }

        // Check departure still in future
        const now = new Date();
        const departure = booking.departureDateTime;
        if (!departure || new Date(departure) <= now) {
          return res.status(400).send({
            message:
              "Departure time has passed. Payment is no longer possible.",
          });
        }

        const price = Number(booking.totalPrice);
        if (!Number.isFinite(price) || price <= 0) {
          return res.status(400).send({ message: "Invalid booking price" });
        }

        const amount = Math.round(price * 100);

        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          customer_email: booking.userEmail,
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: amount,
                product_data: {
                  name: booking.title,
                },
              },
              quantity: 1,
            },
          ],
          metadata: {
            bookingId: booking._id.toString(),
            ticketId: booking.ticketId.toString(),
            ticketName: booking.title,
            userEmail: booking.userEmail,
            vendorEmail: booking.vendorEmail,
          },
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.send({ url: session.url });
      } catch (error) {
        console.error("create-checkout-session error:", error);
        res.status(500).send({ message: error.message });
      }
    });

    // Payment check
    app.patch("/payment-success", verifyFBToken, async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        if (!sessionId) {
          return res.status(400).send({ message: "Missing session_id" });
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId);
        // console.log("Session Retrieve", session);

        if (session.payment_status !== "paid") {
          return res.send({
            success: false,
            message: "Payment not completed.",
          });
        }

        const transactionId = session.payment_intent;
        const userEmailFromSession = session.customer_email;

        const existingPayment = await paymentCollection.findOne({
          transactionId,
        });
        if (existingPayment) {
          return res.send({
            success: true,
            message: "Payment already processed.",
            transactionId,
            amount: existingPayment.amount,
            title: existingPayment.title,
          });
        }

        const bookingId = session.metadata?.bookingId;
        const ticketId = session.metadata?.ticketId;

        if (!bookingId || !ObjectId.isValid(bookingId)) {
          return res
            .status(400)
            .send({ message: "Invalid or missing bookingId in metadata." });
        }

        // Find booking
        const bookingQuery = { _id: new ObjectId(bookingId) };
        const booking = await usersBookingCollection.findOne(bookingQuery);

        if (!booking) {
          return res.status(404).send({ message: "Booking not found." });
        }

        if (booking.userEmail !== userEmailFromSession) {
          return res.status(403).send({ message: "Email mismatch." });
        }

        if (booking.status === "paid") {
          return res.send({
            success: true,
            message: "Booking already marked as paid.",
            transactionId,
            amount: session.amount_total / 100,
            title: booking.title,
          });
        }

        // Mark booking as paid & save paymentIntentId
        await usersBookingCollection.updateOne(bookingQuery, {
          $set: {
            status: "paid",
            paymentIntentId: transactionId,
            updatedAt: new Date(),
          },
        });

        // 2) Reduce ticketQuantity
        if (ticketId && ObjectId.isValid(ticketId)) {
          await ticketsCollection.updateOne(
            { _id: new ObjectId(ticketId) },
            {
              $inc: { ticketQuantity: -booking.bookedQuantity },
              $set: { updatedAt: new Date() },
            }
          );
        }

        // 3) Save payment record (for Transaction History)
        const paymentDoc = {
          bookingId: booking._id,
          ticketId: booking.ticketId,
          title: booking.title,
          amount: session.amount_total / 100,
          currency: session.currency,
          userEmail: booking.userEmail,
          vendorEmail: booking.vendorEmail,
          transactionId,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
        };

        const paymentResult = await paymentCollection.insertOne(paymentDoc);

        res.send({
          success: true,
          transactionId,
          amount: paymentDoc.amount,
          title: paymentDoc.title,
          paymentInfoId: paymentResult.insertedId,
        });
      } catch (error) {
        console.error("payment-success error:", error);
        res
          .status(500)
          .send({ success: false, message: "Payment confirmation failed." });
      }
    });

    // Get all Stripe payments for the logged-in user
    app.get("/payments/user", verifyFBToken, async (req, res) => {
      try {
        const emailFromQuery = req.query.email;
        const emailFromToken = req.decoded_email;

        const userEmail = emailFromQuery || emailFromToken;
        if (!userEmail) {
          return res.status(400).send({ message: "User email is required" });
        }

        if (emailFromQuery && emailFromQuery !== emailFromToken) {
          return res.status(403).send({ message: "forbidden" });
        }

        const cursor = paymentCollection
          .find({ userEmail })
          .sort({ paidAt: -1 });

        const payments = await cursor.toArray();
        res.send(payments);
      } catch (error) {
        console.error("Error fetching user payments:", error);
        res.status(500).send({ message: "Failed to fetch payments" });
      }
    });

    // Vendors APIs

    // Add Tickets
    app.post("/ticket", async (req, res) => {
      try {
        // console.log("Tic Hit");
        const ticket = req.body;
        // console.log(ticket);

        const departureDate = new Date(ticket.departureDateTime);

        if (isNaN(departureDate.getTime())) {
          return res.status(400).send({
            success: false,
            message: "Invalid departure date format",
          });
        }

        const doc = {
          ...ticket,
          vendorEmail: ticket?.vendorEmail,
          vendorName: ticket?.vendorName,
          departureDateTime: departureDate,
          verificationStatus: "pending",
          isHiddenForFraud: false,
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
        // console.log(emailFromQuery);

        // Security: vendor can only see their own tickets
        const vendorEmail = emailFromQuery;
        if (!vendorEmail) {
          return res.status(400).send({ message: "Vendor email is required" });
        }

        const cursor = ticketsCollection
          .find({ vendorEmail })
          .sort({ createdAt: -1 });
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
    app.get(
      "/vendor/booking",
      verifyFBToken,
      verifyVendor,
      async (req, res) => {
        try {
          const vendorEmail = req.vendor.email;
          // console.log(vendorEmail);

          const bookings = await usersBookingCollection
            .find({
              vendorEmail,
              status: "pending",
            })
            .sort({ createdAt: -1 })
            .toArray();

          res.send(bookings);
        } catch (error) {
          console.error("Error fetching vendor bookings:", error);
          res.status(500).send({ message: "Failed to fetch bookings" });
        }
      }
    );

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

    // Get all users (Admin only)
    app.get("/users", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const cursor = usersCollection.find({}).sort({ createdAt: -1 });
        const users = await cursor.toArray();
        res.send(users);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).send({ message: "Failed to fetch users" });
      }
    });

    // Make a user Admin
    app.patch(
      "/users/:id/make-admin",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;

          if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid user id" });
          }

          const query = { _id: new ObjectId(id) };
          const user = await usersCollection.findOne(query);

          if (!user) {
            return res.status(404).send({ message: "User not found" });
          }

          const updateDoc = {
            $set: {
              role: "admin",
              updatedAt: new Date(),
            },
          };

          const result = await usersCollection.updateOne(query, updateDoc);
          res.send(result);
        } catch (error) {
          console.error("Error making admin:", error);
          res.status(500).send({ message: "Failed to update user role" });
        }
      }
    );

    // Make a user Vendor
    app.patch(
      "/users/:id/make-vendor",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;

          if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid user id" });
          }

          const query = { _id: new ObjectId(id) };
          const user = await usersCollection.findOne(query);

          if (!user) {
            return res.status(404).send({ message: "User not found" });
          }

          const updateDoc = {
            $set: {
              role: "vendor",
              updatedAt: new Date(),
            },
          };

          const result = await usersCollection.updateOne(query, updateDoc);
          res.send(result);
        } catch (error) {
          console.error("Error making vendor:", error);
          res.status(500).send({ message: "Failed to update user role" });
        }
      }
    );

    // Mark a vendor as fraud
    app.patch(
      "/users/:id/mark-fraud",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;

          if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid user id" });
          }

          const query = { _id: new ObjectId(id) };
          const user = await usersCollection.findOne(query);

          if (!user) {
            return res.status(404).send({ message: "User not found" });
          }

          if (user.role !== "vendor") {
            return res
              .status(400)
              .send({ message: "Only vendors can be marked as fraud" });
          }

          // 1) Update user document (mark as fraud)
          const userUpdateDoc = {
            $set: {
              isFraud: true,
              updatedAt: new Date(),
            },
          };
          await usersCollection.updateOne(query, userUpdateDoc);

          // 2) Hide all tickets from this vendor
          const ticketsUpdateDoc = {
            $set: {
              isHiddenForFraud: true,
              updatedAt: new Date(),
            },
          };
          const ticketsResult = await ticketsCollection.updateMany(
            { vendorEmail: user.email },
            ticketsUpdateDoc
          );

          res.send({
            success: true,
            modifiedTickets: ticketsResult.modifiedCount,
          });
        } catch (error) {
          console.error("Error marking vendor as fraud:", error);
          res.status(500).send({ message: "Failed to mark vendor as fraud" });
        }
      }
    );

    // Tickets that can be advertised
    app.get(
      "/tickets/advertise",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const cursor = ticketsCollection
            .find({
              adminApprove: true,
              verificationStatus: "approved",
            })
            .sort({ createdAt: -1 });

          const tickets = await cursor.toArray();
          res.send(tickets);
        } catch (error) {
          console.error("Error fetching tickets for advertise:", error);
          res.status(500).send({ message: "Failed to fetch tickets" });
        }
      }
    );

    // Toggle advertise/unadvertise for a ticket (Admin only)
    app.patch(
      "/tickets/:id/advertise",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { advertised } = req.body;

          if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid ticket id" });
          }

          if (typeof advertised !== "boolean") {
            return res
              .status(400)
              .send({ message: "Field 'advertised' must be boolean" });
          }

          const query = { _id: new ObjectId(id) };
          const ticket = await ticketsCollection.findOne(query);

          if (!ticket) {
            return res.status(404).send({ message: "Ticket not found" });
          }

          // Must be admin-approved & not hidden for fraud
          if (
            !ticket.adminApprove ||
            ticket.verificationStatus !== "approved"
          ) {
            return res
              .status(400)
              .send({ message: "Only approved tickets can be advertised" });
          }

          // If turning ON, check max 6 advertised
          if (advertised === true) {
            const advertisedCount = await ticketsCollection.countDocuments({
              adminApprove: true,
              verificationStatus: "approved",
              advertised: true,
            });

            const alreadyAdvertised = ticket.advertised === true;
            if (!alreadyAdvertised && advertisedCount >= 6) {
              return res.status(400).send({
                message: "Cannot advertise more than 6 tickets at a time.",
              });
            }
          }

          const updateDoc = {
            $set: {
              advertised,
              updatedAt: new Date(),
            },
          };

          const result = await ticketsCollection.updateOne(query, updateDoc);
          res.send(result);
        } catch (error) {
          console.error("Error toggling advertise:", error);
          res
            .status(500)
            .send({ message: "Failed to update advertise status" });
        }
      }
    );

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
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
