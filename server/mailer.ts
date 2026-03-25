import nodemailer from "nodemailer";

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return _transporter;
}

export interface SendReplyOptions {
  to: string;
  originalSubject: string;
  body: string;
}

export async function sendEmailReply({ to, originalSubject, body }: SendReplyOptions): Promise<void> {
  const from = process.env.SMTP_USER;
  if (!from) throw new Error("SMTP_USER is not configured");

  const transporter = getTransporter();
  await transporter.sendMail({
    from,
    to,
    subject: `Re: ${originalSubject}`,
    text: body,
  });
}
