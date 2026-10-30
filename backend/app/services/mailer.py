"""Gmail SMTP sender for SOS emails.

`send_email` returns only after the SMTP server has ACCEPTED the message for every
recipient. It raises MailerError (with a message that is safe to show to users and
never contains the password) otherwise. Accepted means "handed off for delivery",
not "read".
"""

import logging
import re
import smtplib
import ssl
import time
from email.message import EmailMessage

from app.config import settings

logger = logging.getLogger(__name__)

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465
SMTP_TIMEOUT_S = 10  # per socket operation (connect, each command, each read)
# Overall budget: smtplib has no total deadline, so we check elapsed time between steps.
# One operation can still run up to SMTP_TIMEOUT_S past it, so the worst case is ~40 s.
SMTP_DEADLINE_S = 30

AMBIGUOUS_MESSAGE = (
    "Connection lost while sending — the email may or may not have been delivered. "
    "Retry, or contact your guardian directly."
)

_CRLF = re.compile(r"[\r\n]+")


class MailerError(Exception):
    """Delivery failed; str(exc) is a user-safe reason."""


class MailerNotConfigured(MailerError):
    def __init__(self) -> None:
        super().__init__("Email service is not configured on the server.")


class MailerAmbiguous(MailerError):
    """Failure after the message may already have been handed to the server."""

    def __init__(self) -> None:
        super().__init__(AMBIGUOUS_MESSAGE)


def clean_header(value: str) -> str:
    """Remove CR/LF so a value can never smuggle extra headers (header injection)."""
    return _CRLF.sub(" ", value).strip()


def send_email(to: str, subject: str, body_text: str, body_html: str | None = None) -> None:
    user, password = settings.gmail_user.strip(), settings.gmail_app_password.strip()
    if not user or not password:
        raise MailerNotConfigured()
    started = time.monotonic()
    msg = EmailMessage()
    msg["From"] = clean_header(user)
    msg["To"] = clean_header(to)
    msg["Subject"] = clean_header(subject)
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")
    # Default context = certificate chain AND hostname verification (CERT_REQUIRED).
    context = ssl.create_default_context()
    stage = "connect"
    refused: dict | None = None  # set only once send_message has returned
    try:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT_S, context=context) as smtp:
            stage = "login"
            smtp.login(user, password)
            if time.monotonic() - started > SMTP_DEADLINE_S:
                raise MailerError("Mail server took too long to respond.")
            stage = "send"
            refused = smtp.send_message(msg)
    except MailerError:
        raise
    except smtplib.SMTPAuthenticationError as exc:
        logger.warning("SMTP login rejected (%s)", type(exc).__name__)
        raise MailerError("Mail server rejected the login.") from exc
    except (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused) as exc:
        logger.warning("SMTP address refused (%s)", type(exc).__name__)
        raise MailerError("Mail server refused the guardian's email address.") from exc
    except UnicodeError as exc:
        raise MailerError("Guardian email address contains unsupported characters.") from exc
    except Exception as exc:
        if refused is not None:
            # send_message already returned: the server accepted the message. A failure
            # in QUIT/close afterwards must not turn that into a failed SOS.
            logger.warning("Error after the message was accepted (ignored): %s", type(exc).__name__)
        elif stage == "send" and (
            isinstance(exc, (smtplib.SMTPServerDisconnected, smtplib.SMTPDataError))
            or (isinstance(exc, OSError) and not isinstance(exc, smtplib.SMTPException))
        ):
            logger.warning("SMTP connection lost during send (%s)", type(exc).__name__)
            raise MailerAmbiguous() from exc
        elif isinstance(exc, smtplib.SMTPException):
            logger.warning("SMTP refused the message at %s (%s)", stage, type(exc).__name__)
            raise MailerError("Mail server refused the message.") from exc
        elif isinstance(exc, OSError):
            logger.warning("SMTP connection failed at %s (%s)", stage, type(exc).__name__)
            raise MailerError("Could not connect to the mail server.") from exc
        else:
            logger.exception("Unexpected mailer error at %s", stage)
            raise MailerError("Unexpected error while sending the email.") from exc
    if refused:  # send_message returns {recipient: error} for refused recipients
        raise MailerError("Mail server refused the guardian's email address.")


class Mailer:
    def send(self, to: str, subject: str, body_text: str, body_html: str | None = None) -> None:
        send_email(to, subject, body_text, body_html)


def get_mailer() -> Mailer:
    """FastAPI dependency; tests override it with a fake."""
    return Mailer()
