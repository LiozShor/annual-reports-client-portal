# Tally Questionnaire Privacy Notice

Privacy notice on **page 1** of both Tally questionnaires (Hebrew `1AkYKb`, English `1AkopM`).
Consent checkbox at the **end of the last question page** (before the thank-you page).

**Status:** Implemented and published (2026-03-12).

---

## Hebrew Version (form `1AkYKb`)

### הודעת פרטיות ואיסוף מידע

משרד רו"ח Client Name אוסף את הפרטים בשאלון זה לצורך הכנת דוח מס שנתי בלבד. המידע מועבר לצוות המשרד, שירותי ענן מאובטחים, ומערכת AI לסיווג מסמכים (עם פיקוח אנושי). תקופת שמירה: 7 שנים (פקודת מס הכנסה). נתוני עיבוד טכניים - 90 יום. בהתאם לתיקון 13 לחוק הגנת הפרטיות, יש לך זכות לעיין, לתקן, למחוק (בכפוף לשמירה חוקית) ולהתנגד.

לפניות: **reports@moshe-atsits.co.il**

---

**תיבת סימון נדרשת (בסוף השאלון, לפני עמוד הסיום):**

> ☐ קראתי והבנתי את הפרטים לעיל ואני מאשר/ת את איסוף ועיבוד המידע לצורך הכנת הדוח השנתי.

---

## English Version (form `1AkopM`)

### Privacy Notice & Data Collection

Moshe Atsits CPA Firm collects the information in this questionnaire for the purpose of preparing your annual tax report only. Your data is shared with our office staff, secure cloud storage services, and an AI document classification system (with human oversight). Retention period: 7 years (Israeli Tax Ordinance). Technical processing data: 90 days. Under the Protection of Privacy Law (Amendment 13), you have the right to access, correct, delete (subject to legal retention), and object to processing.

Contact us: **reports@moshe-atsits.co.il**

---

**Required checkbox (end of questionnaire, before thank-you page):**

> ☐ I have read and understood the above and consent to the collection and processing of my information for the preparation of my annual tax report.

---

## Implementation Notes

1. Privacy notice: `HEADING_3` + `TEXT` + contact `TEXT` + `DIVIDER` — on page 1, after the intro text
2. Consent checkbox: `TITLE` ("אישור" / "Consent") + required `CHECKBOX` — at end of last question page (page 11)
3. The consent response is stored in Tally's submission data — part of the audit trail
4. Consider adding a `consent_given_at` field to the Airtable `תשובות שאלון שנתי` table to capture the timestamp
