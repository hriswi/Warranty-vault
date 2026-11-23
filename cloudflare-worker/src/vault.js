const FILE_LIMIT = 500 * 1024;
const signatures = {
  'application/pdf': [37, 80, 68, 70],
  'image/png': [137, 80, 78, 71, 13, 10, 26, 10],
  'image/jpeg': [255, 216, 255],
  'image/webp': [82, 73, 70, 70],
};
const bad = (message, status = 400) => Response.json({ error: message }, { status });
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

export class WarrantyVault {
  constructor(state) {
    this.storage = state.storage;
    this.sql = state.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS invoices (product TEXT, key TEXT, mime TEXT, name TEXT, bytes BLOB, PRIMARY KEY(product,key))');
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.split('/').pop();
    const id = url.searchParams.get('id');
    if (action === 'list') {
      const rows = this.sql.exec('SELECT data FROM products ORDER BY rowid DESC');
      return Response.json(Array.from(rows, row => JSON.parse(row.data)));
    }
    if (!validId(id)) return bad('Invalid product.');
    if (action === 'download') {
      const key = url.searchParams.get('key');
      if (!validId(key)) return bad('Invalid invoice.');
      const [file] = this.sql.exec('SELECT * FROM invoices WHERE product=? AND key=?', id, key);
      if (!file) return bad('Invoice unavailable.', 404);
      return new Response(file.bytes, { headers: { 'Content-Type': file.mime, 'X-Filename': encodeURIComponent(file.name) } });
    }
    if (action === 'delete') {
      this.storage.transactionSync(() => {
        this.sql.exec('DELETE FROM invoices WHERE product=?', id);
        this.sql.exec('DELETE FROM products WHERE id=?', id);
      });
      return Response.json({ id });
    }
    if (!['create', 'edit', 'repair'].includes(action)) return bad('Unknown action.', 404);
    let fields, file;
    try {
      const form = await request.formData();
      const metadata = form.get('fields');
      if (typeof metadata !== 'string' || metadata.length > 100000) return bad('Invalid product details.');
      fields = JSON.parse(metadata);
      file = form.get('file');
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return bad('Invalid details.');
    } catch { return bad('Invalid upload.'); }
    const key = action === 'repair' ? url.searchParams.get('key') : 'purchase';
    if (!validId(key) || (action === 'repair' && (!file || key === 'purchase'))) return bad('Repair invoice required.');
    let bytes;
    if (file) {
      if (typeof file.arrayBuffer !== 'function' || !Object.hasOwn(signatures, file.type) || !file.size || file.size > FILE_LIMIT) return bad('Use a PDF, JPG, PNG or WEBP file up to 500 KB.');
      bytes = new Uint8Array(await file.arrayBuffer());
      if (!signatures[file.type].every((value, i) => bytes[i] === value) ||
          (file.type === 'image/webp' && String.fromCharCode(...bytes.slice(8,12)) !== 'WEBP')) return bad('The file format does not match its contents.');
    }
    return this.storage.transactionSync(() => {
      const [row] = this.sql.exec('SELECT data FROM products WHERE id=?', id);
      if (action === 'create' && row) return bad('Product already exists.', 409);
      if (action !== 'create' && !row) return bad('Product no longer exists.', 404);
      const now = new Date().toISOString();
      const current = row ? JSON.parse(row.data) : {};
      let product;
      if (action === 'repair') {
        if (!fields.description?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) return bad('Enter a repair date and description.');
        const repairs = current.repairHistory || [];
        if (repairs.some(r => r.fileKey === key)) return Response.json(current);
        const entry = { description: fields.description.trim(), date: fields.date, cost: fields.cost, fileKey: key, filename: file.name };
        product = { ...current, repairHistory: [...repairs, entry] };
      } else {
        if (typeof fields.productName !== 'string' || !fields.productName.trim() || fields.productName.length > 300) return bad('Enter a product name of up to 300 characters.');
        product = { ...current, ...fields, id, repairHistory: row ? current.repairHistory || [] : (Array.isArray(fields.repairHistory) ? fields.repairHistory : []), createdAt: current.createdAt || fields.createdAt || now };
        product.invoiceInCloud = !!file || !!current.invoiceInCloud;
      }
      product.updatedAt = now;
      if (file) this.sql.exec('INSERT OR REPLACE INTO invoices VALUES(?,?,?,?,?)', id, key, file.type, file.name, bytes.buffer);
      this.sql.exec('INSERT OR REPLACE INTO products VALUES(?,?)', id, JSON.stringify(product));
      return Response.json(product);
    });
  }
}
