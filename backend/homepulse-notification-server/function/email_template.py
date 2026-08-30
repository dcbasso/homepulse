"""Branded HTML wrapper for outgoing alert emails."""

import html

_TEMPLATE = """\
<!DOCTYPE html>
<html>
  <body style="margin:0; padding:0; background-color:#f2f4f7; font-family:Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f2f4f7; padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden;">
            <tr>
              <td align="center" style="background-color:#0f172a; padding:24px;">
                <img src="cid:{logo_cid}" alt="HomePulse" width="160" style="display:block;" />
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px; color:#1f2937; font-size:15px; line-height:1.6;">
                {body_html}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px; color:#9ca3af; font-size:12px; text-align:center; border-top:1px solid #e5e7eb;">
                HomePulse
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def build_html_email(body_text: str, logo_cid: str) -> str:
    """Wraps a plain-text alert body in the HomePulse branded HTML template.

    Args:
        body_text: Plain-text email body (already had its ${...} placeholders resolved).
        logo_cid: Content-ID (without angle brackets) of the logo image attached to
            the message, referenced here via a `cid:` URI.

    Returns:
        A complete HTML document string ready to use as the email's HTML part.
    """
    body_html = html.escape(body_text).replace("\n", "<br>")
    return _TEMPLATE.format(logo_cid=logo_cid, body_html=body_html)
