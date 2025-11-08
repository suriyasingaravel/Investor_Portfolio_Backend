const { Router } = require("express");
const multer = require("multer");
const { parseExcel, transformRows } = require("../lib/excel");

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.post("/upload", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res
        .status(400)
        .json({ error: "Attach an Excel file in 'file' field" });
    }

    const { rows, meta } = parseExcel(req.file.buffer);

    if (req.query.debug) {
      return res.json({ meta, rowsPreview: rows.slice(0, 5) });
    }

    if (!rows.length) {
      return res.status(400).json({
        error: "No rows found in Excel",
        hint: "Ensure your first or any sheet has a header row with at least: [Particulars/Symbol], Purchase Price, Qty",
        meta,
      });
    }

    const out = transformRows(rows);
    return res.json(out);
  } catch (err) {
    next(err);
  }
});

router.post("/normalize", async (req, res, next) => {
  try {
    const { rows } = req.body || {};
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ error: "rows[] is required" });
    }
    const out = transformRows(rows);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
