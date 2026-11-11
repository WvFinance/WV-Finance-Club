// Site settings.
// finnhubKey: a free API key from https://finnhub.io/register. It powers the live dollar
// values in the Class Portfolio. Charts, search and headlines work without it.
// briefApi: the address of the brief server (see brief-server/README.md). When it is set,
// searching a stock without a brief writes one on the spot. Leave it empty to turn that off.
// supabaseUrl, supabaseKey: member logins, each member's watchlist and the trading game.
// The publishable key is meant to be public; the database rules keep each member's data private.
window.WVFC_CONFIG = {
  finnhubKey: "",
  briefApi: "https://wvfc-brief-server.wvfinance.workers.dev",
  supabaseUrl: "https://imjzgwjmsixavhioswno.supabase.co",
  supabaseKey: "sb_publishable_yQmY1yE334rgqliGw2WnKQ_x4THAasd"
};

// On our own address (simplestreet.com.co), send logins, trades and briefs through
// simplestreet.com.co/api, so school web filters only need to allow that one name.
if (/(^|\.)simplestreet\.com\.co$/.test(location.hostname)) {
  window.WVFC_CONFIG.briefApi = location.origin + "/api";
  window.WVFC_CONFIG.supabaseUrl = location.origin + "/api/sb";
}
