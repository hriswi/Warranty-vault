export async function researchProduct(name, search) {
  const model = name.split('(')[0].trim().slice(0, 120);
  if (!model) throw new Error('A product model is required.');
  const matches = value => (' ' + String(value).toLowerCase().replace(/[^a-z0-9]+/g,' ') + ' ').includes(' ' + model.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim() + ' ');
  const recallSearch = async () => {
    const url = new URL('https://www.saferproducts.gov/RestWebServices/Recall');
    url.searchParams.set('format','json');
    url.searchParams.set('ProductName',model);
    const res = await fetch(url, {signal: AbortSignal.timeout(9000)});
    if (!res.ok) throw new Error('US CPSC returned HTTP ' + res.status);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('US CPSC returned an unreadable response.');
    return rows.filter(r => /^https:\/\/(?:www\.)?cpsc\.gov\//i.test(r.URL) && matches(r.Title + ' ' + r.Description)).map(r => ({
      category:'recall', status:'Official recall record', title:r.Title, url:r.URL, snippet:r.Description?.slice(0,350), date:r.RecallDate?.slice(0,10)
    }));
  };
  const advisorySearch = async () => {
    const rows = await search('"' + model + '" manufacturer recall safety advisory reliability warning');
    if (!Array.isArray(rows)) throw new Error('Advisory search unavailable.');
    return rows.filter(r => /^https?:\/\//i.test(r.url) && matches(r.title + ' ' + r.snippet) && /recall|safety|advisory|overheat|defect|reliability/i.test(r.title + ' ' + r.snippet)).map(r => ({...r,category:'advisory',status:'Unverified report'}));
  };
  const results = await Promise.allSettled([recallSearch(),advisorySearch()]);
  const failures = results.flatMap((r,i) => r.status === 'rejected' ? [(i ? 'Advisory search' : 'US CPSC') + ': ' + r.reason.message] : []);
  if (failures.length === 2) throw new Error(failures.join('. '));
  return {ok:true, evidence:results.flatMap(r => r.status === 'fulfilled' ? r.value : []), failures, researchedAt:new Date().toISOString(), query:model};
}
