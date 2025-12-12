import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import fetch from "node-fetch";
import crypto from "crypto";
import bcrypt from "bcryptjs";

dotenv.config();

const app = express();

/* ================= MIDDLEWARE ================= */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static("public")); // für Logo

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
  })
);

/* ================= CONFIG ================= */
const SHOP = process.env.SHOPIFY_SHOP; // *.myshopify.com
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const HASH = bcrypt.hashSync(
  process.env.SALES_REP_PASSWORD || "WUSTHOF1!",
  10
);

/* ================= TRANSLATIONS ================= */
const T = {
  de: {
    title: "Meine Kunden",
    search: "Kunde suchen (Name, Firma, E-Mail, Kundennummer)",
    noCustomers: "Keine Kunden zugeordnet.",
    loginTitle: "Sales Login",
    email: "E-Mail",
    password: "Passwort",
    login: "Login",
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
  return T[req.session.lang] || T.en;
}

/* ================= SHOPIFY GRAPHQL ================= */
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

/* ================= PAGINATION ================= */
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
  let all = [];
  let after = null;
  let hasNext = true;

  while (hasNext && all.length < limit) {
    const data = await fetchCustomers(after);
    all.push(...data.customers.nodes);
    hasNext = data.customers.pageInfo.hasNextPage;
    after = data.customers.pageInfo.endCursor;
  }
  return all;
}

/* ================= SALES REP FILTER ================= */
function customerBelongsToRep(customer, repEmail) {
  const mf = customer.metafields?.nodes?.find(
    (m) => m.key === "sales_reps"
  );
  if (!mf?.value) return false;

  return mf.value
    .toLowerCase()
    .split(/[\n,;]/)
    .map((v) => v.trim())
    .includes(repEmail.toLowerCase());
}

/* ================= MULTIPASS ================= */
function multipass(payload) {
  const key = crypto
    .createHash("sha256")
    .update(process.env.MULTIPASS_SECRET)
    .digest();

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-128-cbc", key.slice(0, 16), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload)),
    cipher.final(),
  ]);

  const sig = crypto
    .createHmac("sha256", key.slice(16))
    .update(Buffer.concat([iv, encrypted]))
    .digest();

  return Buffer.concat([iv, encrypted, sig]).toString("base64url");
}

/* ================= ROUTES ================= */

// ---- Language Switch
app.get("/lang/:l", (req, res) => {
  req.session.lang = req.params.l;
  res.redirect("back");
});

// ---- Login
app.get("/login", (req, res) => {
  const L = lang(req);
  res.send(`
    <h2>${L.loginTitle}</h2>
    <a href="/lang/de">DE</a> | <a href="/lang/en">EN</a> | <a href="/lang/fr">FR</a>
    <form method="post">
      <input name="email" placeholder="${L.email}" required><br><br>
      <input name="password" type="password" placeholder="${L.password}" required><br><br>
      <button>${L.login}</button>
    </form>
  `);
});

app.post("/login", (req, res) => {
  if (!bcrypt.compareSync(req.body.password, HASH)) {
    return res.send("Wrong password");
  }
  req.session.email = req.body.email.toLowerCase();
  res.redirect("/customers");
});

// ---- Customers
app.get("/customers", async (req, res) => {
  if (!req.session.email) return res.redirect("/login");
  const L = lang(req);

  const customers = (await getAllCustomers()).filter((c) =>
    customerBelongsToRep(c, req.session.email)
  );

  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${L.title}</title>
<style>
body { font-family: Arial, sans-serif; background:#f6f7f8; margin:0 }
header { background:#fff; padding:20px; border-bottom:1px solid #ddd; display:flex; align-items:center; justify-content:space-between }
.logo { height:40px }
.container { max-width:1000px; margin:30px auto; padding:0 20px }
.search { width:100%; padding:12px; margin-bottom:20px }
.customer { background:#fff; border:1px solid #ddd; border-radius:8px; padding:14px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center }
.meta { font-size:13px; color:#555 }
button { padding:8px 12px; cursor:pointer }
</style>
</head>

<body>

<header>
  <div style="display:flex;align-items:center;gap:20px">
    <img src="/logo.svg" class="logo" alt="WÜSTHOF">
    <h2>${L.title} (${customers.length})</h2>
  </div>
  <div>
    <a href="/lang/de">DE</a> |
    <a href="/lang/en">EN</a> |
    <a href="/lang/fr">FR</a>
  </div>
</header>

<div class="container">

<input class="search" id="search" placeholder="${L.search}" onkeyup="filter()">

${
  customers.length
    ? customers
        .map(
          (c) => `
<div class="customer">
  <div>
    <strong>${c.displayName || "-"}</strong>
    <div class="meta">
      ${c.email}
      ${c.defaultAddress?.company ? ` · ${c.defaultAddress.company}` : ""}
      ${c.note ? ` · ${L.customerNo}: ${c.note}` : ""}
    </div>
  </div>
  <form method="post" action="/go">
    <input type="hidden" name="email" value="${c.email}">
    <button>Login</button>
  </form>
</div>
`
        )
        .join("")
    : `<p>${L.noCustomers}</p>`
}

</div>

<script>
function filter(){
  const q=document.getElementById("search").value.toLowerCase();
  document.querySelectorAll(".customer").forEach(c=>{
    c.style.display=c.innerText.toLowerCase().includes(q)?"flex":"none";
  });
}
</script>

</body>
</html>
`);
});

// ---- Multipass
app.post("/go", (req, res) => {
  const token = multipass({
    email: req.body.email,
    created_at: new Date().toISOString(),
  });

  res.redirect(
    \`https://\${process.env.SHOPIFY_CUSTOM_DOMAIN || "b2b.wusthof.com"}/account/login/multipass/\${token}\`
  );
});

/* ================= START ================= */
app.listen(process.env.PORT || 10000, () =>
  console.log("Sales portal running")
);
