const laptopFamily = /\b(thinkpad|thinkbook|ideapad|macbook|vivobook|zenbook|inspiron|latitude|pavilion|aspire|swift|elitebook|laptop|notebook)\b/i;
const phoneFamily = /\b(redmi|iphone|galaxy|smartphone|earbuds)\b/i;

export function planLookup(question, products = []) {
  const price = /\b(price|pricing|costs?|how much)\b/i.test(question);
  if (/\b(what did I pay|what I paid|purchase price|invoice price|how much did I pay)\b/i.test(question)) return null;
  if (!price && !/\b(specs?|specifications?|features?|release|launch|recall|advisory|known issue|review|latest|search|look up|online)\b/i.test(question)) return null;
  const inventory = Array.isArray(products) ? products : [];
  if (/\bmy laptop\b/i.test(question)) {
    const names = [...new Set(inventory.filter(p=>p?.productName && !phoneFamily.test(p.productName) &&
      (laptopFamily.test(p.productName) || /laptop/i.test(p.category))).map(p=>p.productName.trim()))];
    if (names.length !== 1) return {reply:names.length ? 'Which laptop should I look up? ' + names.join(', ') : 'What is the brand and model of your laptop?'};
    return {query:names[0] + (price ? ' price India' : ' official specifications'), subject:names[0]};
  }
  if (price && /\biphone\b/i.test(question)) {
    return {query:question.replace(/[<>?]/g,' ')+' Apple India INR site:apple.com/in/shop/buy-iphone', subject:'iPhone pricing in India', price:true};
  }
  return {query:question + (price ? ' India INR' : ''), subject:question, price};
}

export function manufacturerSpecs(question, subject) {
  if (!/\b(specs?|specifications?|features?)\b/i.test(question) ||
      !/^(?:Lenovo\s+)?ThinkPad E14 Gen 5$/i.test(subject)) return null;
  const sources = ['Intel', 'AMD'].map(chip => {
    const model = 'ThinkPad_E14_Gen_5_' + chip;
    return {title:'Lenovo specifications (' + chip + ')', url:'https://psref.lenovo.com/syspool/Sys/PDF/ThinkPad/' + model + '/' + model + '_Spec.pdf'};
  });
  return {sources, text:'Lenovo lists the ThinkPad E14 Gen 5 with Intel and AMD variants. Both offer a 14-inch 1920 × 1200 display option. Your saved model name alone does not identify the installed CPU, RAM or SSD. For your actual CPU and RAM, open Windows Settings → System → About.'};
}
