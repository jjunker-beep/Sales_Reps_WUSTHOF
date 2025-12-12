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

// ================= CONFIG =================
const SHOP = process.env.SHOPIFY_SHOP; // myshopify.com Domain!
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const HASH = bcrypt.hashSync(
  process.env.SALES_REP_PASSWORD || "WUSTHOF1!",
  10
);

// ================= SHOPIFY GQL =================
async function gql(query) {
  const r = await fetch(
    `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN,
      },
      body: JSON.stringify({ query }),
    }
  );

  const j = await r.json();
  if (j.errors) {
    console.error(j.errors);
    throw new Error("Shopify GraphQL Error");
  }
  return j.data;
}

// ================= PAGINATION =================
async function fetchCustomers(after = null) {
  const query = `
    query {
      customers(first: 100${after ? `, after: "${after}"` : ""}) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          email
          displayName
          note
        }
      }
    }
  `;
  return gql(query);
}

async function getAllCustomers(limit = 500) {
  let all = [];
  let after = null;
  let hasNext = true;

  while (hasNext && all.length < limit) {
    const data = await fetchCustomers(after);
    const conn = data.customers;

    all.push(...conn.nodes);
    hasNext = conn.pageInfo.hasNextPage;
    after = conn.pageInfo.endCursor;
  }

  return all;
}

// ================= MULTIPASS =================
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

// ================= ROUTES =================

// -------- LOGIN --------
app.get("/login", (_req, res) => {
  res.send(`
    <h2>Sales Login</h2>
    <form method="post">
      <input name="email" type="email" placeholder="E-Mail" required /><br><br>
      <input name="password" type="password" placeholder="Passwort" required /><br><br>
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

// -------- CUSTOMERS --------
app.get("/customers", async (req, res) => {
  if (!req.session.email) return res.redirect("/login");

  const customers = await getAllCustomers(500);

  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Meine Kunden</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    input { padding: 8px; width: 380px; margin-bottom: 16px; }
    .customer { margin-bottom: 10px; }
    button { padding: 8px 12px; cursor: pointer; }
    .note { color: #555; font-size: 13px; margin-left: 6px; }
  </style>
</head>
<body>

<h2>Meine Kunden (${customers.length})</h2>

<input
  type="text"
  id="search"
  placeholder="Kunde suchen (Name, E-Mail oder Kundennummer)"
  onkeyup="filterCustomers()"
/>

<div id="customer-list">
  ${customers
    .map(
      (c) => `
    <div class="customer">
      <form method="post" action="/go">
        <input type="hidden" name="email" value="${c.email}">
        <button type="submit">
          ${c.displayName || "(ohne Namen)"} (${c.email})
        </button>
        ${
          c.note
            ? `<span class="note">– Nr.: ${c.note}</span>`
            : ""
        }
      </form>
    </div>
  `
    )
    .join("")}
</div>

<script>
  function filterCustomers() {
    const q = document.getElementById("search").value.toLowerCase();
    document.querySelectorAll(".customer").forEach(el => {
      el.style.display = el.innerText.toLowerCase().includes(q)
        ? "block"
        : "none";
    });
  }
</script>

</body>
</html>
  `);
});

// -------- GO (MULTIPASS) --------
app.post("/go", (req, res) => {
  const token = multipass({
    email: req.body.email,
    created_at: new Date().toISOString(),
  });

  res.redirect(
    `https://${SHOP}/account/login/multipass/${token}`
  );
});

// ================= START =================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Sales portal running on port", PORT);
});
