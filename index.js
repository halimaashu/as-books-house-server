import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import SSLCommerzPayment from "sslcommerz-lts";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose-cjs";
import {
  canReadOrdersFor,
  createPaymentHandlers,
  validateSslCommerzByTransactionId,
  validateSslCommerzByValidationId,
} from "./paymentSecurity.js";
import { calculateOrderTotals } from "./orderPricing.js";
import { sendPaymentConfirmationEmail } from "./paymentEmail.js";

dotenv.config();

const app = express();
const normalizeOrigin = (value) => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};
const allowedOrigins = new Set([
  process.env.FRONTEND_URL,
  ...(process.env.NODE_ENV !== "production" ? ["http://localhost:3000", "http://127.0.0.1:3000"] : []),
].map(normalizeOrigin).filter(Boolean));
app.use(cors({
  origin(origin, callback) {
    // CORS controls browser access to responses; it must not block gateway form posts
    // (for example SSLCommerz payment callbacks) from reaching server-side verification.
    return callback(null, !origin || allowedOrigins.has(normalizeOrigin(origin)));
  },
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
const store_id = process.env.SSLCOMMERZ_STORE_ID;
const store_passwd = process.env.SSLCOMMERZ_STORE_PASSWORD;
const is_live = false; //true for live, false for sandbox
const port = process.env.PORT || 5000;
const uri = process.env.MONGO_DB_URI;

if (!uri) {
  throw new Error("MONGO_DB_URI is missing. Check your .env file.");
}

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
const JWKS = createRemoteJWKSet(
  new URL(`${process.env.FRONTEND_URL}api/auth/jwks`),
);

// very fy jwt Bearer
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
    return res.status(401).json({
      message: "You are unAuthorizees",
    });
  }
  const token = authHeader?.split(/\s+/)[1];
  if (!token) {
    return res.status(401).json({
      message: "You are unAuthorize",
    });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    if (!payload.sub) throw new Error("JWT subject is missing");
    req.auth = payload;
    next();
  } catch {
    return res.status(401).json({
      message: "You are unAuthorize",})
  }
};


async function runStableAPIConnect() {
  try {
    await client.connect();

    // await client.db("admin").command({ ping: 1 });
    const db = client.db("book-hunt");
    const bookCollection = db.collection("books");
    const userCollection = db.collection("user");
    const ordersCollection = db.collection("orders");
    const paymentHandlers = createPaymentHandlers({
      ordersCollection,
      validateByValId: (valId) => validateSslCommerzByValidationId({
        valId,
        storeId: store_id,
        storePassword: store_passwd,
        isLive: is_live,
      }),
      validateByTranId: (tranId) => validateSslCommerzByTransactionId({
        tranId,
        storeId: store_id,
        storePassword: store_passwd,
        isLive: is_live,
      }),
      frontendUrl: process.env.NODE_ENV === "production"
        ? process.env.FRONTEND_URL
        : process.env.LOCAL_FRONTEND_URL || "http://localhost:3000",
      storeId: store_id,
      onPaid: (order) => sendPaymentConfirmationEmail(order, {
        frontendUrl: process.env.NODE_ENV === "production"
          ? process.env.FRONTEND_URL
          : process.env.LOCAL_FRONTEND_URL || "http://localhost:3000",
      }),
    });
    const polytechnicBookSetCollection = db.collection("polytechnicBookSet");

    // simple a example for store data at database
    //   const doc = {
    //   title: "Charade",
    //   genres: ["Comedy", "Romance", "Thriller"],
    //   year: 1963,
    //   cast: ["Cary Grant", "Audrey Hepburn", "Walter Matthau"],
    // }
    // const result = await bookCollection.insertOne(doc);

    console.log("Successfully connected to MongoDB!");

    app.get("/", (req, res) => {
      res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Ashik | Software Engineer</title>

      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          font-family: Arial, sans-serif;
          color: #e2e8f0;
          background: #08111f;
        }

        .card {
          width: 100%;
          max-width: 850px;
          padding: 45px;
          border: 1px solid #263852;
          border-radius: 24px;
          background: linear-gradient(145deg, #111d30, #0b1423);
          box-shadow: 0 25px 70px #0008;
        }

        .tag {
          display: inline-block;
          padding: 8px 14px;
          border: 1px solid #2563eb;
          border-radius: 30px;
          color: #93c5fd;
          background: #1d4ed822;
          font-size: 13px;
          margin-bottom: 22px;
        }

        h1 {
          font-size: clamp(36px, 7vw, 58px);
          margin-bottom: 12px;
          color: #60a5fa;
        }

        h2 {
          font-size: 23px;
          margin-bottom: 18px;
          color: #f8fafc;
        }

        p {
          line-height: 1.8;
          color: #b8c6dc;
          margin-bottom: 20px;
        }

        .info {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 14px;
          margin: 25px 0;
        }

        .item {
          padding: 17px;
          border: 1px solid #263852;
          border-radius: 14px;
          background: #172439;
        }

        .item strong {
          display: block;
          margin-bottom: 8px;
          color: #60a5fa;
        }

        .skills {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 16px;
        }

        .skills span {
          padding: 9px 13px;
          border-radius: 9px;
          color: #bfdbfe;
          background: #1e3a5f;
          border: 1px solid #315783;
          font-size: 14px;
        }

        .footer {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #263852;
          color: #93c5fd;
          text-align: center;
        }
      </style>
    </head>

    <body>
      <main class="card">
        <span class="tag">WELCOME TO MY SPACE</span>

        <h1>Ashikur Rahman</h1>
        <h2>Software Engineer in Progress | Web Developer</h2>

        <p>
          Hi, I'm Ashik, a Computer Science and Technology diploma student
          from Bangladesh. I'm passionate about software engineering,
          web development, problem-solving, and building useful applications.
          I enjoy learning new technologies and turning ideas into real projects.
        </p>

        <div class="info">
          <div class="item">
            <strong>Education</strong>
            Diploma in Engineering — CST
          </div>

          <div class="item">
            <strong>Profession</strong>
            Aspiring Software Engineer
          </div>

          <div class="item">
            <strong>Location</strong>
            Bangladesh
          </div>
        </div>

        <h2>Technologies I Work With</h2>

        <div class="skills">
          <span>HTML</span>
          <span>CSS</span>
          <span>JavaScript</span>
          <span>TypeScript</span>
          <span>React</span>
          <span>Next.js</span>
          <span>Node.js</span>
          <span>Express.js</span>
          <span>MongoDB</span>
          <span>Git & GitHub</span>
          <span>Tailwind CSS</span>
        </div>

        <div class="footer">
          Build today. Learn every day. Create tomorrow.
        </div>
      </main>
    </body>
    </html>
  `);
    });

    // this api for get all users
    app.get("/users", async (req, res) => {
      try {
        const users = await userCollection.find().toArray();
        res.status(200).json({
          message: "Access user success full",
          data: users,
        });
      } catch (error) {
        console.log(error);
        res.status(500).json({
          message: "failed to fetch all users",
        });
      }
    });

    // This api for Added a new book
    app.post("/book",verifyToken, async (req, res) => {
      try {
        const bookData = req.body;
        console.log(bookData, "its post from the books datas");
        const result = await bookCollection.insertOne(bookData);
        res.status(201).json({
          message: "Book Added Success",
          insertId: result.insertedId,
        });
      } catch (error) {
        console.log(error);
        res.status(500).json({
          message: "Booked added Failed",
        });
      }
    });
    // this api made for gate all books
    app.get("/books", async (req, res) => {
      try {
        const data = await bookCollection.find().toArray();
        res.status(200).send(data);
      } catch (error) {
        console.log(error);
        res.status(500).json({
          message: "Failed to Loaded the books",
        });
      }
    });
    // this api for delete a book from the books
    app.delete("/books/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await bookCollection.deleteOne({
          _id: new ObjectId(id),
        });
        if (result.deletedCount === 0) {
          return res.status(404).json({
            message: "Book not found",
          });
        }
        res.status(200).json({
          message: "Book deleted successfully",
          deletedCount: result.deletedCount,
        });
      } catch (error) {
        console.log(error);
        res.status(500).json({
          message: "Failed to delete the book",
        });
      }
    });
    // this api made for gate speacefic book
    app.get("/books/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const data = await bookCollection.findOne({
          _id: new ObjectId(id),
        });
        res.status(200).send(data);
      } catch (error) {
        console.log(error);
        res.status(500).json({
          message: "Failed to Loaded the books",
        });
      }
    });

    // this api for update book data
    app.patch("/books/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const data = req.body;
        const result = await bookCollection.updateOne(
          {
            _id: new ObjectId(id),
          },
          {
            $set: data,
          },
        );
        res.status(200).json({
          message: "Update Book data success full",
        });
      } catch (error) {
        console.log(error);
        res.status(500).json({
          message: "Failed to update this book data",
        });
      }
    });
    // Physical-book checkout. Price and ownership come from the database and signed JWT.
    app.post("/order", verifyToken, async (req, res) => {
      try {
        if (!store_id || !store_passwd) return res.status(503).json({ message: "Payment service is not configured" });
        const bookId = String(req.body?.bookId || "");
        if (!ObjectId.isValid(bookId)) return res.status(400).json({ message: "Invalid book" });
        const quantity = Number(req.body?.quantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) return res.status(400).json({ message: "Invalid quantity" });
        const email = String(req.auth.email || "").trim().toLowerCase();
        if (!email) return res.status(401).json({ message: "Authenticated account email is unavailable" });
        const buyBook = await bookCollection.findOne({ _id: new ObjectId(bookId) });
        if (!buyBook) return res.status(404).json({ message: "Book not found" });
        const available = Number(buyBook.available_quantity);
        if (Number.isFinite(available) && quantity > available) return res.status(409).json({ message: "Requested quantity is not available" });
        const unitPrice = Number(buyBook.price);
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) return res.status(400).json({ message: "Book price is invalid" });
        const district = String(req.body?.district || "").trim();
        const division = String(req.body?.division || "").trim();
        if (!division) return res.status(400).json({ message: "Delivery division is required" });
        const totals = calculateOrderTotals(unitPrice, quantity, district, division);
        if (!totals) return res.status(400).json({ message: "Choose a valid district within the selected division" });
        const { subtotalAmount, deliveryCharge, totalAmount } = totals;
        const transitionId = new ObjectId().toString();
        const orderId = new ObjectId().toString();
        const input = req.body;
        const properAddress = "district:" + district + " thana:" + (input.thana || "") + " address:" + (input.address || "");
        const finalOrder = {
          orderId, name: String(input.fullName || "").slice(0, 120), phone: String(input.phone || "").slice(0, 40),
          email, userId: String(req.auth.sub), bookId: buyBook._id, bookTitle: buyBook.title,
          author: buyBook.author || "", division, district,
          price: unitPrice, subtotalAmount, deliveryCharge, totalAmount, quantity, properAddress, transitionId, isPaid: false,
          paymentStatus: "pending", currency: "BDT", createdAt: new Date(),
        };
        await ordersCollection.insertOne(finalOrder);
        const configuredBackendUrl = process.env.NODE_ENV === "production"
          ? process.env.BACKEND_URL
          : process.env.LOCAL_BACKEND_URL || "http://localhost:5000";
        const backendUrl = String(configuredBackendUrl || "").replace(/\/+$/, "");
        if (!backendUrl) {
          await ordersCollection.updateOne({ transitionId }, { $set: { paymentStatus: "init_failed" } });
          return res.status(503).json({ message: "Payment service is not configured" });
        }
        const data = {
          total_amount: totalAmount, currency: "BDT", tran_id: transitionId, value_a: orderId,
          success_url: backendUrl + "/success/payment/" + transitionId,
          fail_url: backendUrl + "/fail/payment/" + transitionId,
          cancel_url: backendUrl + "/cancel/payment/" + transitionId,
          ipn_url: backendUrl + "/ipn", shipping_method: "Courier",
          product_name: String(buyBook.title).slice(0, 255), product_category: String(buyBook.category || "Books").slice(0, 50),
          product_profile: "physical-goods", cus_name: finalOrder.name, cus_email: email,
          cus_add1: String(input.division || "Bangladesh").slice(0, 100), cus_add2: properAddress.slice(0, 100),
          cus_city: "Dhaka", cus_state: String(input.division || "Dhaka").slice(0, 50),
          cus_postcode: String(input.postCode || "").slice(0, 20), cus_country: "Bangladesh",
          cus_phone: finalOrder.phone, cus_fax: "", ship_name: finalOrder.name,
          ship_add1: properAddress.slice(0, 100), ship_add2: String(input.district || "").slice(0, 100),
          ship_city: String(input.district || "Dhaka").slice(0, 50), ship_state: String(input.division || "Dhaka").slice(0, 50),
          ship_postcode: String(input.postCode || "").slice(0, 20), ship_country: "Bangladesh",
        };
        const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
        const apiResponse = await sslcz.init(data);
        if (!apiResponse?.GatewayPageURL) {
          await ordersCollection.updateOne({ transitionId, isPaid: false }, { $set: { paymentStatus: "init_failed" } });
          return res.status(502).json({ message: "Could not start payment session" });
        }
        return res.status(200).json({ url: apiResponse.GatewayPageURL });
      } catch (error) {
        console.error("Order checkout initialization failed:", error.message);
        return res.status(500).json({ message: "Could not start checkout" });
      }
    });

    app.post("/success/payment/:transitionId", paymentHandlers.success);
    app.post("/ipn", paymentHandlers.ipn);
    app.post("/fail/payment/:transitionId", paymentHandlers.failed);
    app.post("/cancel/payment/:transitionId", paymentHandlers.cancelled);

    app.get("/payment/status/:transitionId", async (req, res) => {
      try {
        if (!ObjectId.isValid(req.params.transitionId)) return res.status(404).json({ isPaid: false });
        const order = await ordersCollection.findOne({ transitionId: req.params.transitionId }, { projection: { isPaid: 1 } });
        if (!order) return res.status(404).json({ isPaid: false });
        return res.status(200).json({ isPaid: order.isPaid === true });
      } catch (error) {
        console.error("Payment status lookup failed:", error.message);
        return res.status(503).json({ isPaid: false });
      }
    });

    app.get("/order/:email", verifyToken, async (req, res) => {
      try {
        if (!canReadOrdersFor(req.auth, req.params.email)) return res.status(403).json({ message: "Forbidden" });
        const email = String(req.auth.email).trim().toLowerCase();
        const result = await ordersCollection.find({ email }).toArray();
        return res.status(200).json({ data: result });
      } catch (error) {
        console.error("Order history access failed:", error.message);
        return res.status(500).json({ message: "Failed to access orders" });
      }
    });
    // get all orders
    app.get("/orders",verifyToken, async(req,res)=>{
      try{
        if (req.auth.role !== "admin") return res.status(403).json({ message: "Forbidden" });
        const result=await ordersCollection.find().toArray()
        res.status(201).json({
         
          data:result
        })

      }catch(error){
        console.log(error)
        res.status(400).json({message:"Failed to Access teh orders"})
      }
    })
    // Order a set of book for Polytechnoic
    app.post("/polytechnic",verifyToken,async(req,res)=>{
      try{
        const data=req.body
        const res=await polytechnicBookSetCollection.insertOne(data)
        res.status(201).json({
          message:"Book  set added success full"
        })

      }catch(error){
        console.log(error)
        res.status(400).json({
          message:"Fail to save data on server"
        })
      }
    })
    app.get("/polytechnic" ,verifyToken,async(req,res)=>{
      try{
        const result= await polytechnicBookSetCollection.find().toArray()
        res.status(201).json({
          message:"ok",
          data:result
        })

      }catch(error){
        console.log(error)
        res.status(400).json({
          message:"Faild do Acces the Book order"
        })
      }
    })

    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    process.exitCode = 1;
  }
}

runStableAPIConnect();
