require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");

const pricesRouter = require("./routes/prices");
const fundamentalsRouter = require("./routes/fundamentals");
const portfolioRouter = require("./routes/portfolio");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(helmet());
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

app.get("/", (req, res) => {
  res.json({ ok: true, message: "Portfolio Finance API", ts: Date.now() });
});

app.use("/api/prices", pricesRouter);
app.use("/api/fundamentals", fundamentalsRouter);
app.use("/api/portfolio", portfolioRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  const code = err.status || 500;
  res.status(code).json({
    error: err.message || "Server error",
    ts: Date.now(),
  });
});

app.listen(PORT, () => console.log(`API listening on ${PORT}`));
