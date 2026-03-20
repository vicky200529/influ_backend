import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import fs from "fs/promises";
import nodemailer from "nodemailer";

const app = express();
const PORT = 3000;
const CONTACTS_FILE = path.join(process.cwd(), "contacts.json");

// Lazy initialize nodemailer transporter
let transporter: nodemailer.Transporter | null = null;

const getTransporter = () => {
  if (!transporter) {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_PASS;

    if (!user || !pass) {
      console.warn("Email credentials missing. Emails will not be sent.");
      return null;
    }

    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
  }
  return transporter;
};

app.use(cors());
app.use(express.json());

// API Routes
app.get("/api/stats", (req, res) => {
  try {
    res.json({
      instagram: { followers: "1.2M", engagement: "4.5%" },
      tiktok: { followers: "2.8M", engagement: "8.2%" },
      youtube: { subscribers: "850K", views: "12M/mo" }
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

const contactLimits = new Map<string, number>();

app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, message, subject } = req.body;
    const ip = req.ip || "unknown";
    const now = Date.now();
    
    if (contactLimits.has(ip) && now - contactLimits.get(ip)! < 60000) {
      return res.status(429).json({ error: "Too many requests. Please wait 1 minute." });
    }
    
    contactLimits.set(ip, now);

    if (!name || !email || !message) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // Attempt to store inquiry (will fail on Vercel, but we catch it)
    try {
      let contacts = [];
      try {
        const data = await fs.readFile(CONTACTS_FILE, "utf-8");
        contacts = JSON.parse(data);
      } catch (e) {
        contacts = [];
      }
      
      const newInquiry = {
        id: Date.now().toString(),
        name,
        email,
        message,
        subject,
        date: new Date().toISOString()
      };
      contacts.push(newInquiry);
      // Only try to write if we are not in a read-only environment
      await fs.writeFile(CONTACTS_FILE, JSON.stringify(contacts, null, 2));
    } catch (fsError) {
      console.warn("Local file storage not available (expected on Vercel).");
    }

    // Send Email
    const mailTransporter = getTransporter();
    if (mailTransporter) {
      await mailTransporter.sendMail({
        from: process.env.GMAIL_USER,
        to: process.env.GMAIL_USER,
        subject: `New Media Kit Inquiry: ${subject || "General"}`,
        text: `Name: ${name}\nEmail: ${email}\nSubject: ${subject}\n\nMessage:\n${message}`,
        replyTo: email,
      });
      console.log("Email sent successfully");
    } else {
      throw new Error("Email transporter not configured");
    }

    res.status(201).json({ success: true, message: "Message received" });
  } catch (error) {
    console.error("Error in contact route:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Internal server error" });
  }
});

// Vite middleware for development
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
}

if (process.env.NODE_ENV !== "production") {
  setupVite().then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
}


