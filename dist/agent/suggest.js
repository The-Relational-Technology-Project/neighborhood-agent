const CONSENT = "Check that whoever keeps it is OK with it being public, and keep personal phone numbers and emails out unless the person said yes.";
const HINTS = {
    doc: { label: "Doc", hint: `Read it. A list of recommendations becomes a recs/ file (Claude Code can convert it, the way Outer Dadas Recs was). Background or history becomes an archive/ note. Places, groups, or resources go in places.yml, people.yml (with each person's yes), or resources.yml. ${CONSENT}` },
    spreadsheet: { label: "Spreadsheet", hint: `If it should stay live, publish it as CSV (Google Sheets: File, Share, Publish to web, CSV) and add a csv source in sources.yml with title and text templates. If it's a one-time list, convert it into places.yml, resources.yml, or a recs/ file. ${CONSENT}` },
    calendar: { label: "Calendar", hint: "Add an ics source in sources.yml with the calendar's public iCal URL (Google Calendar: Settings, Integrate calendar, Public address in iCal format)." },
    feed: { label: "Feed", hint: "Add an rss source in sources.yml with the feed URL. Pick a kind (archive-note for news, event for event feeds)." },
    site: { label: "Site", hint: "If it's something neighbors built, add it to resources.yml with the questions it answers. If it has a calendar, a feed, a Neighborhood API, or an llm.txt, add that as a source. Check robots.txt and terms first; Knowy doesn't read sites that don't offer a page or feed meant for it." },
    file: { label: "File", hint: `Open the attachment in this email. ${CONSENT}` },
};
export function classifySuggestion(url, filename) {
    const u = (url ?? "").trim().toLowerCase();
    const f = (filename ?? "").toLowerCase();
    let type = "site";
    if (f)
        type = /\.(xlsx|xls|csv|tsv|numbers|ods)$/.test(f) ? "spreadsheet" : /\.(pdf|docx?|md|txt|rtf|odt|pages)$/.test(f) ? "doc" : /\.ics$/.test(f) ? "calendar" : "file";
    else if (/docs\.google\.com\/spreadsheets|airtable\.com|\.csv(\?|$)|output=csv/.test(u))
        type = "spreadsheet";
    else if (/docs\.google\.com\/document|notion\.(so|site)|\.pdf(\?|$)|\.docx?(\?|$)|dropbox\.com|drive\.google\.com/.test(u))
        type = "doc";
    else if (/^webcal:|\.ics(\?|$)|calendar\.google\.com|\/calendar\.ics/.test(u))
        type = "calendar";
    else if (/\/(feed|rss)\/?$|\.(rss|atom)(\?|$)|\/rss\.xml|\/atom\.xml|\/feed\.xml/.test(u))
        type = "feed";
    return { type, ...HINTS[type] };
}
export const ALLOWED_UPLOAD = /\.(pdf|docx?|xlsx?|csv|tsv|md|txt|rtf|odt|ods|ics)$/i;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // under Vercel's 4.5MB request limit
//# sourceMappingURL=suggest.js.map