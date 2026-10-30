import logging
import smtplib
import ssl

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
    send_error: Exception | None = None
    exit_error: Exception | None = None

    def __init__(self, host, port, timeout=None, context=None):
        if FakeSMTP.connect_error:
            raise FakeSMTP.connect_error
        self.host, self.port, self.timeout, self.context = host, port, timeout, context
        self.logged_in = None
        self.sent = []
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        if FakeSMTP.exit_error:
            raise FakeSMTP.exit_error
        return False

    def login(self, user, password):
        if FakeSMTP.login_error:
            raise FakeSMTP.login_error
        self.logged_in = (user, password)

    def send_message(self, msg):
        if FakeSMTP.send_error:
            raise FakeSMTP.send_error
        self.sent.append(msg)
        return FakeSMTP.send_result


@pytest.fixture(autouse=True)
def fake_smtp(monkeypatch):
    FakeSMTP.instances = []
    FakeSMTP.login_error = None
    FakeSMTP.send_result = {}
    FakeSMTP.connect_error = None
    FakeSMTP.send_error = None
    FakeSMTP.exit_error = None
    monkeypatch.setattr(mailer.smtplib, "SMTP_SSL", FakeSMTP)
    monkeypatch.setattr(settings, "gmail_user", "sender@gmail.com")
    monkeypatch.setattr(settings, "gmail_app_password", "app-pass-123")


def test_send_builds_message_and_logs_in():
    send_email("guardian@example.com", "Hello", "plain body", "<p>html body</p>")
    smtp = FakeSMTP.instances[0]
    assert (smtp.host, smtp.port, smtp.timeout) == ("smtp.gmail.com", 465, 10)
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


def test_tls_context_verifies_certificate_and_hostname():
    send_email("g@example.com", "S", "b")
    ctx = FakeSMTP.instances[0].context
    assert isinstance(ctx, ssl.SSLContext)
    assert ctx.verify_mode == ssl.CERT_REQUIRED and ctx.check_hostname is True


@pytest.mark.parametrize("exit_error", [smtplib.SMTPServerDisconnected("gone"), smtplib.SMTPResponseException(421, b"bye")])
def test_error_on_quit_after_acceptance_still_counts_as_sent(exit_error, caplog):
    FakeSMTP.exit_error = exit_error
    with caplog.at_level(logging.WARNING):
        send_email("g@example.com", "S", "b")  # must not raise
    assert FakeSMTP.instances[0].sent
    assert any("after the message was accepted" in r.getMessage() for r in caplog.records)


def test_exit_error_with_refused_recipients_is_still_failure():
    FakeSMTP.send_result = {"g@example.com": (550, b"x")}
    FakeSMTP.exit_error = smtplib.SMTPServerDisconnected("gone")
    with pytest.raises(MailerError, match="refused"):
        send_email("g@example.com", "S", "b")


AMBIGUOUS = "Connection lost while sending — the email may or may not have been delivered."


@pytest.mark.parametrize(
    "error",
    [smtplib.SMTPServerDisconnected("x"), smtplib.SMTPDataError(451, b"later"), TimeoutError("t"), ConnectionResetError("r")],
)
def test_failures_during_send_are_ambiguous(error):
    FakeSMTP.send_error = error
    with pytest.raises(mailer.MailerAmbiguous) as exc:
        send_email("g@example.com", "S", "b")
    assert AMBIGUOUS in str(exc.value)
    assert isinstance(exc.value, MailerError)


def test_definite_refusal_during_send_is_not_ambiguous():
    FakeSMTP.send_error = smtplib.SMTPSenderRefused(550, b"no", "a@b.c")
    with pytest.raises(MailerError) as exc:
        send_email("g@example.com", "S", "b")
    assert not isinstance(exc.value, mailer.MailerAmbiguous)


def test_disconnect_during_login_is_not_ambiguous():
    FakeSMTP.login_error = smtplib.SMTPServerDisconnected("x")
    with pytest.raises(MailerError) as exc:
        send_email("g@example.com", "S", "b")
    assert not isinstance(exc.value, mailer.MailerAmbiguous)


def test_non_ascii_subject_and_body_encoded():
    subject = "EMERGENCY: Zoë தமிழ் needs help"
    send_email("g@example.com", subject, "உதவி தேவை Zoë", "<p>உதவி Zoë</p>")
    msg = FakeSMTP.instances[0].sent[0]
    assert msg["Subject"] == subject
    assert "உதவி தேவை Zoë" in msg.get_body(("plain",)).get_content()
    assert "உதவி Zoë" in msg.get_body(("html",)).get_content()
    assert msg.as_bytes()  # serialises (RFC 2047 / utf-8 transfer encoding)


def test_unicode_encode_error_is_mailer_error():
    FakeSMTP.send_error = UnicodeEncodeError("ascii", "é", 0, 1, "bad")
    with pytest.raises(MailerError, match="unsupported characters"):
        send_email("g@example.com", "S", "b")


def test_generic_failure_is_logged_without_password(caplog):
    FakeSMTP.login_error = smtplib.SMTPException("boom app-pass-123")
    with caplog.at_level(logging.WARNING), pytest.raises(MailerError):
        send_email("g@example.com", "S", "b")
    assert caplog.records and "app-pass-123" not in caplog.text


def test_overall_deadline_aborts_before_sending(monkeypatch):
    ticks = iter([0.0, 31.0, 31.0, 31.0])
    monkeypatch.setattr(mailer.time, "monotonic", lambda: next(ticks))
    with pytest.raises(MailerError, match="too long"):
        send_email("g@example.com", "S", "b")
    assert not FakeSMTP.instances[0].sent
