/* ============================================================
   PIN hashing. The plaintext PIN never leaves the browser and is
   never stored — only this salted SHA-256 hash travels with a
   submission, so the maintainer never sees the PIN.
   crypto.subtle needs a secure context: available on https:// and
   on http://localhost (both count as secure), so local dev works.
   ============================================================ */

export async function sha256Hex(str){
  const bytes = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/* Salt by the (lowercased) name so the same PIN under different names
   yields different hashes. Returns "" if either part is missing. */
export async function pinHashFor(name, pin){
  const n = (name || "").trim().toLowerCase();
  const p = (pin || "").trim();
  if(!n || !p) return "";
  return sha256Hex(n + ":" + p);
}
