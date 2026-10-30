import smtplib

import pytest

from app.config import settings
from app.services import mailer
from app.services.mailer import MailerError, MailerNotConfigured, send_email


class FakeSMTP:
    """Stands in for smtplib.SMTP_SSL; records calls, never touches the network."""

    instances: list["FakeSMTP"] = []
    login_error: Exception | None = None
    send_result: dict = {}
    connect_error: Exception | None = None

    def __init__(self, host, port, timeout=None):
        if FakeSMTP.connect_error:
            raise FakeSMTP.connect_error
        self.host, self.port, self.timeout = host, port, timeout
        self.logged_in = None
        self.sent = []
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def login(self, user, password):
        if FakeSMTP.login_error:
            raise FakeSMTP.login_error
        self.logged_in = (user, password)

    def send_message(self, msg):
        self.sent.append(msg)
        return FakeSMTP.send_result


@pytest.fixture(autouse=True)
def fake_smtp(monkeypatch):
    FakeSMTP.instances = []
    FakeSMTP.login_error = None
    FakeSMTP.send_result = {}
    FakeSMTP.connect_error = None
    monkeypatch.setattr(mailer.smtplib, "SMTP_SSL", FakeSMTP)
    monkeypatch.setattr(settings, "gmail_user", "sender@gmail.com")
    monkeypatch.setattr(settings, "gmail_app_password", "app-pass-123")


def test_send_builds_message_and_logs_in():
    send_email("guardian@example.com", "Hello", "plain body", "<p>html body</p>")
    smtp = FakeSMTP.instances[0]
    assert (smtp.host, smtp.port, smtp.timeout) == ("smtp.gmail.com", 465, 15)
    assert smtp.logged_in == ("sender@gmail.com", "app-pass-123")
    msg = smtp.sent[0]
    assert msg["From"] == "sender@gmail.com"
    assert msg["To"] == "guardian@example.com"
    assert msg["Subject"] == "Hello"
    assert "plain body" in msg.get_body(("plain",)).get_content()
    assert "<p>html body</p>" in msg.get_body(("html",)).get_content()


def test_plain_only_has_no_html_part():
    send_email("g@example.com", "S", "just text")
    assert FakeSMTP.instances[0].sent[0].get_body(("html",)) is None


@pytest.mark.parametrize("user,password", [("", "x"), ("a@gmail.com", ""), ("", "")])
def test_not_configured(monkeypatch, user, password):
    monkeypatch.setattr(settings, "gmail_user", user)
    monkeypatch.setattr(settings, "gmail_app_password", password)
    with pytest.raises(MailerNotConfigured):
        send_email("g@example.com", "S", "b")
    assert FakeSMTP.instances == []


def test_not_configured_is_a_mailer_error():
    assert issubclass(MailerNotConfigured, MailerError)


def test_header_injection_stripped():
    send_email("g@example.com\r\nBcc: evil@example.com", "Hi\r\nBcc: evil@example.com", "b")
    msg = FakeSMTP.instances[0].sent[0]
    assert "\n" not in msg["Subject"] and "\r" not in msg["Subject"]
    assert msg["Bcc"] is None
    assert "\n" not in msg["To"]


def test_refused_recipients_is_failure():
    FakeSMTP.send_result = {"g@example.com": (550, b"no such user")}
    with pytest.raises(MailerError) as exc:
        send_email("g@example.com", "S", "b")
    assert "refused" in str(exc.value).lower()


@pytest.mark.parametrize(
    "error,expected",
    [
        (smtplib.SMTPAuthenticationError(535, b"bad creds app-pass-123"), "Mail server rejected the login."),
        (smtplib.SMTPRecipientsRefused({"g@example.com": (550, b"x")}), "refused"),
        (smtplib.SMTPException("boom app-pass-123"), "Mail server"),
        (TimeoutError("timed out"), "Could not connect"),
        (OSError("network down"), "Could not connect"),
    ],
)
def test_login_errors_map_to_safe_messages(error, expected):
    FakeSMTP.login_error = error
    with pytest.raises(MailerError) as exc:
        send_email("g@example.com", "S", "b")
    assert expected in str(exc.value)
    assert "app-pass-123" not in str(exc.value)


def test_connect_failure_is_mailer_error():
    FakeSMTP.connect_error = OSError("unreachable")
    with pytest.raises(MailerError, match="Could not connect"):
        send_email("g@example.com", "S", "b")
