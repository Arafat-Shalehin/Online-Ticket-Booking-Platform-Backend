---

## Backend README (Server)

```markdown
# TicketBari – Online Ticket Booking Platform (Server)

This is the **backend** for TicketBari, a role-based online ticket booking platform.

It is built with:

- **Node.js + Express**
- **MongoDB (native driver)**
- **Firebase Admin SDK** for auth verification
- **Stripe** for payment processing

The backend exposes secure REST APIs for:

- User registration and role management
- Ticket management (add, approve, reject, advertise, hide fraud)
- Booking lifecycle (pending → accepted/rejected → paid)
- Stripe payment intents and confirmations
- Vendor statistics and transaction history

---

## 🧱 Tech Stack

- **Node.js + Express**
- **MongoDB** (Native Driver, no Mongoose)
- **Firebase Admin SDK** (JWT/ID token verification)
- **Stripe** (Checkout Sessions)
- **CORS**, **dotenv**

Collections used:

- `allUsers`
- `allTickets`
- `userBookingTickets`
- `payments`

---

## ⚙️ Environment Variables

Create a `.env` file in the server root:

```bash
PORT=5000

# MongoDB connection
MONGODB_URI=your_mongodb_connection_string

# Stripe
STRIPE_SECRET=your_stripe_secret_key

# Frontend domain (used in Stripe success/cancel URLs)
SITE_DOMAIN=http://localhost:5173

# Firebase Admin uses a service account JSON file
# Example: online-ticket-booking-platform-key.json
# Do NOT commit this file to your repo.
📦 Collections & Data Model (Simplified)
allUsers
JavaScript

{
  _id: ObjectId,
  name: String,
  email: String,
  photoURL: String,
  role: "user" | "vendor" | "admin",
  isFraud: Boolean,        // true if marked as fraud by admin
  createdAt: Date,
  updatedAt: Date
}
allTickets
JavaScript

{
  _id: ObjectId,
  title: String,
  image: String,
  from: String,
  to: String,
  transportType: "Bus" | "Train" | "Launch" | "Plane",
  perks: [String],
  price: Number,           // per unit
  ticketQuantity: Number,  // remaining tickets
  departureDateTime: Date,

  vendorName: String,
  vendorEmail: String,

  verificationStatus: "pending" | "approved" | "rejected",
  adminApprove: Boolean,
  advertised: Boolean,
  isHiddenForFraud: Boolean,

  createdAt: Date,
  updatedAt: Date
}
userBookingTickets
JavaScript

{
  _id: ObjectId,
  ticketId: ObjectId,
  image: String,
  title: String,
  userName: String,
  userEmail: String,
  vendorEmail: String,
  from: String,
  to: String,
  unitPrice: Number,
  bookedQuantity: Number,
  totalPrice: Number,
  departureDateTime: Date,
  status: "pending" | "accepted" | "rejected" | "paid",
  paymentIntentId: String | null,
  createdAt: Date,
  updatedAt: Date
}
payments
JavaScript

{
  _id: ObjectId,
  bookingId: ObjectId,
  ticketId: ObjectId,
  title: String,
  amount: Number,
  currency: String,
  userEmail: String,
  vendorEmail: String,
  transactionId: String,   // Stripe payment_intent id
  paymentStatus: String,   // e.g. "paid"
  paidAt: Date
}
🔌 Key Endpoints (Overview)
Auth / Users
POST /registerUsers
Creates a user document after Firebase login (if not exists).

GET /users/:email
Get user profile by email.

GET /users (Admin)
List all users.

PATCH /users/:id/make-admin (Admin)

PATCH /users/:id/make-vendor (Admin)

PATCH /users/:id/mark-fraud (Admin)
Marks vendor as fraud; hides all their tickets and blocks them from adding tickets.

Tickets
GET /sixTickets
Returns up to 6 advertised, admin-approved, non-fraud tickets for homepage advertisement section.

GET /latestTickets
Latest admin-approved tickets.

GET /allTickets
All admin-approved, non-fraud tickets for All Tickets page.

GET /ticket/:id
Get a single ticket by ID (used for ticket details).

GET /singleTicket/:id (Protected)
Get an approved ticket for payment (if needed).

POST /ticket (Vendor)
Add a new ticket (only for non-fraud vendors).

GET /tickets/vendor (Vendor)
List tickets added by the vendor.

DELETE /tickets/:id (Vendor)
Delete vendor’s own ticket (not rejected).

PATCH /tickets/:id (Vendor)
Update vendor’s own ticket (not rejected).

Admin Ticket Management
GET /tickets/admin (Admin)
List all tickets for Manage Tickets.

PATCH /tickets/:id/approve (Admin)
Approve a ticket.

PATCH /tickets/:id/reject (Admin)
Reject a ticket.

Advertise Tickets
GET /tickets/advertise (Admin)
List all approved, non-fraud tickets that can be advertised.

PATCH /tickets/:id/advertise (Admin)
Toggle advertised flag.
Enforces max 6 advertised tickets at a time.

Bookings
POST /bookingTicket/:ticketId (User)
Creates a booking with:

Quantity validation against ticketQuantity
Only if ticket is approved & not departed
Status = pending
GET /bookedTickets

?email=userEmail – Get all bookings for a user.
?status=pending – Filter by status (optional).
GET /bookings/vendor (Vendor)
Get all pending bookings for that vendor.

PATCH /bookings/:id/accept (Vendor)
Accepts a pending booking → status: "accepted".

PATCH /bookings/:id/reject (Vendor)
Rejects a pending booking → status: "rejected".

GET /bookings/:id (Protected)
Get a single booking (used for Payment page).

Payments (Stripe)
POST /create-checkout-session (User)
Body: { bookingId }
Validates:

Booking exists and belongs to current user
Booking status === "accepted"
Departure in the future
Creates a Stripe Checkout Session:
Amount = booking.totalPrice
Metadata: { bookingId, ticketId, ticketName, ... }
Returns a session.url to redirect the user to Stripe.
PATCH /payment-success?session_id=... (User)
Validates Stripe session:

payment_status === "paid"
Finds booking by bookingId in session metadata.
Idempotent:
If already processed, returns existing payment info.
On first success:
Sets booking status: "paid", stores paymentIntentId.
Decreases ticket’s ticketQuantity by bookedQuantity.
Inserts a document into payments collection.
GET /payments/user?email=... (User)
Returns all payments for the logged-in user for Transaction History.

Vendor Statistics
GET /stats/vendor?email=... (Vendor)
Uses userBookingTickets where status: "paid" to compute:
totalRevenue = sum(totalPrice)
totalTicketsSold = sum(bookedQuantity)
totalTicketsAdded = count(tickets) for that vendor.
🚀 Running the Server Locally
Bash

# 1. Install dependencies
npm install

# 2. Start development server (with nodemon)
npm run dev

# or without nodemon
npm start

# Default:
# http://localhost:5000
Ensure:

MongoDB is running and MONGODB_URI is set.
Stripe secret key and Firebase Admin credentials are correctly configured.
Client is configured to call http://localhost:5000 and send the Firebase ID token in the Authorization header.
🔒 CORS & Security
cors() is enabled; you should restrict it to your frontend domain in production.
All sensitive routes (bookings, payments, dashboard data) are protected with:
verifyFBToken to validate Firebase ID token.
Role-based middlewares: verifyAdmin, verifyVendor.
✅ Features Implemented (Backend Side)
Secure Firebase ID token verification.
Role-based access control for User, Vendor, Admin.
Fraud vendor handling:
Mark vendor as fraud.
Hide all their tickets from the platform.
Block them from adding tickets.
Full booking lifecycle:
Pending → Accepted/Rejected → Paid.
Stripe checkout integration:
Server-side session creation.
Payment confirmation & idempotent logging.
Vendor statistics & user transaction history.
📄 License
This backend is part of the TicketBari MERN assignment and is intended for educational and portfolio purposes.
You may reuse patterns or snippets with attribution where appropriate.
```
