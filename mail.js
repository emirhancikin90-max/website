// Optionaler Mailversand. Aktiv, wenn SMTP_URL gesetzt ist, z. B. smtps://user:pass@smtp.example.com:465
const nodemailer = require('nodemailer');
const transporter = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;

async function send({ to, subject, text, from, replyTo }) {
  if (!transporter || !to) return;
  try {
    await transporter.sendMail({ from: process.env.MAIL_FROM || from, to, subject, text, replyTo });
  } catch (e) {
    console.error('E-Mail konnte nicht gesendet werden:', e.message);
  }
}
module.exports = { send, enabled: !!transporter };
