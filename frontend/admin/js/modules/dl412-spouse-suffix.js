// DL-412: append " – {spouse_name}" to a doc name when the spouse tab is active.
// Guard with .includes() so SPOUSE-scoped templates that already substituted
// {spouse_name} via their pattern don't double-tag.
window._dl412AppendSpouse = function (name, person, spouseName) {
    const sn = (spouseName || '').trim();
    return (person === 'spouse' && sn && name && !name.includes(sn)) ? `${name} – ${sn}` : name;
};
