import { generateKeyPairSync } from "node:crypto";

const decodeBase64Url = value => Buffer.from(value, "base64url");
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicJwk = publicKey.export({ format: "jwk" });
const privateJwk = privateKey.export({ format: "jwk" });
const uncompressed = Buffer.concat([
  Buffer.from([4]),
  decodeBase64Url(publicJwk.x),
  decodeBase64Url(publicJwk.y)
]);

console.log("VAPID_PUBLIC_KEY=" + uncompressed.toString("base64url"));
console.log("VAPID_PRIVATE_KEY=" + privateJwk.d);
console.log("\nGuarde a chave privada somente nos Secrets da Edge Function.");
