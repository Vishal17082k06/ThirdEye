"""Gmail SMTP sender for SOS emails.

`send_email` returns only after the SMTP server has ACCEPTED the message for every
recipient. It raises MailerError (with a message that is safe to show to users and
never contains the password) otherwise. Accepted means "handed off for delivery",
not "read".
"""

import re
import smtplib
from email.message import EmailMessage

from app.config import settings

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465
SMTP_TIMEOUT_S = 15

_CRLF = re.compile(r"[\r\n]+")


class MailerError(Exception):
    """Delivery failed; str(exc) is a user-safe reason."""


class MailerNotConfigured(MailerError):
    def __init__(self) -> None:
        super().__init__("Email service is not configured on the server.")


def clean_header(value: str) -> str:
    """Remove CR/LF so a value can never smuggle extra headers (header injection)."""
    return _CRLF.sub(" ", value).strip()


def send_email(to: str, subject: str, body_text: str, body_html: str | None = None) -> None:
    user, password = settings.gmail_user.strip(), settings.gmail_app_password.strip()
    if not user or not password:
        raise MailerNotConfigured()
    msg = EmailMessage()
    msg["From"] = clean_header(user)
    msg["To"] = clean_header(to)
    msg["Subject"] = clean_header(subject)
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")
    try:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT_S) as smtp:
            smtp.login(user, password)
            refused = smtp.send_message(msg)
    except smtplib.SMTPAuthenticationError as exc:
        raise MailerError("Mail server rejected the login.") from exc
    except smtplib.SMTPRecipientsRefused as exc:
        raise MailerError("Mail server refused the guardian's email address.") from exc
    except smtplib.SMTPException as exc:
        raise MailerError("Mail server refused the message.") from exc
    except OSError as exc:  # includes timeouts and connection errors
        raise MailerError("Could not connect to the mail server.") from exc
    if refused:  # send_message returns {recipient: error} for refused recipients
        raise MailerError("Mail server refused the guardian's email address.")


class Mailer:
    def send(self, to: str, subject: str, body_text: str, body_html: str | None = None) -> None:
        send_email(to, subject, body_text, body_html)


def get_mailer() -> Mailer:
    """FastAPI dependency; tests override it with a fake."""
    return Mailer()
