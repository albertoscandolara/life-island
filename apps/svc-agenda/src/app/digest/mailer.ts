import { createTransport } from 'nodemailer';

/** One email: plain text and HTML of the same message. */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** How svc-agenda sends email; a test gives its own. */
export interface Mailer {
  /** False when no SMTP server is set (SMTP_URL): nothing can be sent. */
  readonly configured: boolean;
  send(mail: Mail): Promise<void>;
}

/** Sends through the SMTP server of SMTP_URL; not configured without one. */
export function smtpMailer(url: string | null, from: string): Mailer {
  if (!url)
    return {
      configured: false,
      send: () => Promise.reject(new Error('SMTP_URL is not set')),
    };
  // A server that does not answer fails the send in seconds, to be retried.
  const transport = createTransport(
    {
      url,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    },
    { from },
  );
  return {
    configured: true,
    async send(mail) {
      await transport.sendMail(mail);
    },
  };
}
