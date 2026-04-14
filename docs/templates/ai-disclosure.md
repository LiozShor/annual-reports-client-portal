# AI Processing Disclosure — Ready-to-Use Text

Three versions for different contexts, each in Hebrew and English.

---

## Version 1: Client Email (1-2 sentences)

For inclusion in the document requirement email sent by workflow [03] — add near the footer.

**Hebrew:**
> מסמכים שנשלחים למשרד נבדקים באמצעות מערכת בינה מלאכותית לזיהוי וסיווג אוטומטי, עם פיקוח ואישור של צוות המשרד.

**English:**
> Documents sent to our office are reviewed using an AI system for automatic identification and classification, with oversight and approval by our office staff.

---

## Version 2: Client Portal Footer (1-2 sentences)

For `view-documents.html` — add as a small text note near the contact card or at the bottom of the page.

**Hebrew:**
> מסמכים שנשלחים למשרד מסווגים באמצעות בינה מלאכותית עם פיקוח אנושי. לשאלות: reports@moshe-atsits.co.il

**English:**
> Documents sent to our office are classified using AI with human oversight. Questions: reports@moshe-atsits.co.il

### Implementation (view-documents.html)

Add this inside the `.contact-card` or after it:

```html
<div class="ai-disclosure text-xs text-muted" style="text-align: center; margin-top: var(--sp-4); padding: var(--sp-3); border-top: 1px solid var(--neutral-200);">
    <span id="ai-disc-he">מסמכים שנשלחים למשרד מסווגים באמצעות בינה מלאכותית עם פיקוח אנושי.</span>
    <span id="ai-disc-en" class="hidden">Documents sent to our office are classified using AI with human oversight.</span>
</div>
```

Add to `switchLanguage()`:
```javascript
const aiDiscHe = document.getElementById('ai-disc-he');
const aiDiscEn = document.getElementById('ai-disc-en');
if (aiDiscHe) aiDiscHe.classList.toggle('hidden', !isHe);
if (aiDiscEn) aiDiscEn.classList.toggle('hidden', isHe);
```

---

## Version 3: Privacy Policy Paragraph (full paragraph)

For inclusion in the client-facing privacy policy page.

**Hebrew:**

> ### שימוש בבינה מלאכותית
>
> המשרד משתמש במערכת בינה מלאכותית (Anthropic Claude) לצורך זיהוי וסיווג מסמכים שנשלחים על ידי לקוחות. המערכת מנתחת את תוכן המסמכים ומתאימה אותם לרשימת המסמכים הנדרשים לדוח השנתי. כל סיווג נבדק ומאושר על ידי צוות המשרד לפני ביצוע כל פעולה. תמונות המסמכים נשלחות לשרתי Anthropic בארה״ב לצורך הניתוח בלבד, ונמחקות תוך 7 ימים (קיימת גם אפשרות למחיקה מיידית). לא נעשה שימוש במידע שלך לאימון המערכת. יש לך זכות לבקש שהמסמכים שלך ייבדקו ידנית בלבד - פנה למשרד בכתובת reports@moshe-atsits.co.il.

**English:**

> ### Use of Artificial Intelligence
>
> Our office uses an AI system (Anthropic Claude) to identify and classify documents submitted by clients. The system analyzes document content and matches it to the list of required documents for your annual report. Every classification is reviewed and approved by our office staff before any action is taken. Document images are sent to Anthropic's servers in the United States for analysis only, and are deleted within 7 days (a zero-day retention option is also available). Your data is not used to train the system. You have the right to request that your documents be reviewed manually only - contact us at reports@moshe-atsits.co.il.
