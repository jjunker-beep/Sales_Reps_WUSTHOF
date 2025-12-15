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


// ✅ DAS WAR NOCH NICHT DRIN
app.use(express.static("public"));

// ================= CONFIG =================
const SHOP = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const HASH = bcrypt.hashSync(process.env.SALES_REP_PASSWORD || "WUSTHOF1!", 10);

// ================= TRANSLATIONS =================
const t = {
  de: {
    title: "Meine Kunden",
    search: "Kunde suchen (Name, Firma, E-Mail, Kundennummer)",
    noCustomers: "Keine Kunden zugeordnet.",
    loginTitle: "Sales Login",
    email: "E-Mail",
    password: "Passwort",
    login: "Einloggen",
    customerNo: "Nr.",
  },
  en: {
    title: "My Customers",
    search: "Search customer (name, company, email, customer no.)",
    noCustomers: "No customers assigned.",
    loginTitle: "Sales Login",
    email: "Email",
    password: "Password",
    login: "Login",
    customerNo: "No.",
  },
  fr: {
    title: "Mes clients",
    search: "Rechercher un client (nom, société, e-mail, numéro)",
    noCustomers: "Aucun client attribué.",
    loginTitle: "Connexion commerciale",
    email: "E-mail",
    password: "Mot de passe",
    login: "Connexion",
    customerNo: "N°",
  },
};

function lang(req) {
  return t[req.session.lang] || t.de;
}

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
  if (j.errors) throw new Error("Shopify GraphQL Error");
  return j.data;
}

// ================= PAGINATION =================
async function fetchCustomers(after = null) {
  return gql(`
    query {
      customers(first: 100${after ? `, after: "${after}"` : ""}) {
        pageInfo { hasNextPage endCursor }
        nodes {
          email
          displayName
          note
          defaultAddress { company }
          metafields(first: 10, namespace: "custom") {
            nodes { key value }
          }
        }
      }
    }
  `);
}

async function getAllCustomers(limit = 1000) {
  let all = [], after = null, hasNext = true;
  while (hasNext && all.length < limit) {
    const data = await fetchCustomers(after);
    all.push(...data.customers.nodes);
    hasNext = data.customers.pageInfo.hasNextPage;
    after = data.customers.pageInfo.endCursor;
  }
  return all;
}

// ================= SALES REP FILTER =================
function customerBelongsToRep(customer, repEmail) {
  const mf = customer.metafields?.nodes?.find(m => m.key === "sales_reps");
  if (!mf?.value) return false;
  return mf.value
    .toLowerCase()
    .split(/[\n,;]/)
    .map(v => v.trim())
    .includes(repEmail.toLowerCase());
}

// ================= MULTIPASS =================
function multipass(payload) {
  const key = crypto.createHash("sha256").update(process.env.MULTIPASS_SECRET).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-128-cbc", key.slice(0,16), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  const sig = crypto.createHmac("sha256", key.slice(16))
    .update(Buffer.concat([iv, encrypted]))
    .digest();
  return Buffer.concat([iv, encrypted, sig]).toString("base64url");
}

// ================= ROUTES =================

// -------- LANGUAGE SWITCH --------
app.get("/lang/:l", (req, res) => {
  req.session.lang = req.params.l;
  res.redirect("back");
});

// -------- LOGIN --------
app.get("/login", (req, res) => {
  const L = lang(req);
  res.send(`
<!DOCTYPE html>
<html>
<head>
<style>
body {
  font-family: Arial, sans-serif;
  background:#f4f4f4;
}
.container {
  max-width:420px;
  margin:80px auto;
  background:#3e3642;
  padding:30px;
  color:#fff;
  border-radius:6px;
}
.logo {
  text-align:center;
  margin-bottom:20px;
}
input {
  width:100%;
  padding:10px;
  margin-bottom:12px;
}
button {
  width:100%;
  padding:10px;
  background:#e30613;
  color:#fff;
  border:none;
  cursor:pointer;
}
.lang {
  text-align:center;
  margin-bottom:15px;
}
.lang a { color:#fff; margin:0 6px; }
</style>
</head>
<body>

<div class="container">
  <div class="logo">
    <img src="/wusthof-logo.jpg" width="140">
  </div>

  <h3>${L.loginTitle}</h3>

  <div class="lang">
    <a href="/lang/de">DE</a> | <a href="/lang/en">EN</a> | <a href="/lang/fr">FR</a>
  </div>

  <form method="post">
    <input name="email" placeholder="${L.email}" required>
    <input name="password" type="password" placeholder="${L.password}" required>
    <button>${L.login}</button>
  </form>
</div>

</body>
</html>
`);
});

// -------- LOGIN POST --------
app.post("/login", (req, res) => {
  if (!bcrypt.compareSync(req.body.password, HASH)) {
    return res.send("Wrong password");
  }
  req.session.email = req.body.email.toLowerCase();
  res.redirect("/customers");
});

// -------- CUSTOMERS --------
app.get("/customers", async (req, res) => {
  if (!req.session.email) return res.redirect("/login");
  const L = lang(req);

  const customers = (await getAllCustomers())
    .filter(c => customerBelongsToRep(c, req.session.email));

  res.send(`
<!DOCTYPE html>
<html>
<head>
<style>
body {
  font-family: Arial, sans-serif;
  background:#f4f4f4;
}
.wrapper {
  max-width:900px;
  margin:40px auto;
  background:#fff;
  padding:30px;
  border-radius:6px;
}
.header {
  display:flex;
  justify-content:space-between;
  align-items:center;
}
input {
  width:100%;
  padding:10px;
  margin:20px 0;
}
.customer {
  padding:12px;
  border-bottom:1px solid #ddd;
}
button {
  background:#e30613;
  color:#fff;
  border:none;
  padding:6px 12px;
  cursor:pointer;
}
.note, .company {
  font-size:13px;
  color:#555;
  margin-left:6px;
}
.lang a { margin-left:10px; }
</style>
</head>
<body>

<div class="wrapper">
  <div class="header">
    <h2>${L.title} (${customers.length})</h2>
    <div class="lang">
      <a href="/lang/de">DE</a>
      <a href="/lang/en">EN</a>
      <a href="/lang/fr">FR</a>
    </div>
  </div>

  <input id="search" placeholder="${L.search}" onkeyup="filter()">

  ${
    customers.length
      ? customers.map(c => `
    <div class="customer">
      <form method="post" action="/go">
        <button>${c.displayName || "-"} (${c.email})</button>
        ${c.defaultAddress?.company ? `<span class="company">🏢 ${c.defaultAddress.company}</span>` : ""}
        ${c.note ? `<span class="note">– ${L.customerNo}: ${c.note}</span>` : ""}
        <input type="hidden" name="email" value="${c.email}">
      </form>
    </div>
  `).join("")
      : `<p>${L.noCustomers}</p>`
  }
</div>

<script>
function filter(){
  const q=document.getElementById("search").value.toLowerCase();
  document.querySelectorAll(".customer").forEach(c=>{
    c.style.display=c.innerText.toLowerCase().includes(q)?"block":"none";
  });
}
</script>

</body>
</html>
`);
});

// -------- GO --------
app.post("/go", (req, res) => {
  const token = multipass({ email: req.body.email, created_at: new Date().toISOString() });
  res.redirect(
    `https://${process.env.SHOPIFY_CUSTOM_DOMAIN || "b2b.wusthof.com"}/account/login/multipass/${token}`
  );
});

// ================= START =================
app.listen(process.env.PORT || 10000, () =>
  console.log("Sales portal running")
);
