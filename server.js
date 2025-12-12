import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import fetch from "node-fetch";
import crypto from "crypto";
import bcrypt from "bcryptjs";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
  })
);

const SHOP = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";
const HASH = bcrypt.hashSync(process.env.SALES_REP_PASSWORD || "WUSTHOF1!", 10);

async function gql(query) {
  const r = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

function multipass(payload) {
  const key = crypto
    .createHash("sha256")
    .update(process.env.MULTIPASS_SECRET)
    .digest();
  const encKey = key.slice(0, 16);
  const sigKey = key.slice(16);

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-128-cbc", encKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload)),
    cipher.final(),
  ]);

  const data = Buffer.concat([iv, encrypted]);
  const sig = crypto.createHmac("sha256", sigKey).update(data).digest();
  return Buffer.concat([data, sig]).toString("base64url");
}

// ---- ROUTES ----

app.get("/login", (_req, res) => {
  res.send(`
    <h2>Sales Login</h2>
    <form method="post">
      <input name="email" type="email" placeholder="E-Mail" required />
      <input name="password" type="password" placeholder="Passwort" required />
      <button>Login</button>
    </form>
  `);
});

app.post("/login", (req, res) => {
  if (!bcrypt.compareSync(req.body.password, HASH)) {
    return res.send("Falsches Passwort");
  }
  req.session.email = req.body.email.toLowerCase();
  res.redirect("/customers");
});

app.get("/customers", async (req, res) => {
  if (!req.session.email) return res.redirect("/login");

  const data = await gql(`
    query {
      customers(first: 100) {
        nodes {
          email
          displayName
          metafield(namespace: "custom", key: "sales_rep_email") {
            value
          }
        }
      }
    }
  `);

  const list = data.customers.nodes;

  res.send(`
    <h2>Meine Kunden</h2>
    ${list
      .map(
        (c) => `
      <form method="post" action="/go">
        <input type="hidden" name="email" value="${c.email}">
        <button>${c.displayName} (${c.email})</button>
      </form>
    `
      )
      .join("")}
  `);
});

app.post("/go", (req, res) => {
  const token = multipass({
    email: req.body.email,
    created_at: new Date().toISOString(),
  });
  res.redirect(`https://${SHOP}/account/login/multipass/${token}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Sales portal running on port", PORT);
});
