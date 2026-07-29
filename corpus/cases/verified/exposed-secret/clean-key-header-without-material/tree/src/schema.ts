export const tlsClientKeyField = {
  name: "tlsClientKey",
  label: "TLS client key",
  placeholder: "Begins with -----BEGIN RSA PRIVATE KEY-----",
};

export function isPemFormatted(value: string): boolean {
  return value.startsWith("-----BEGIN PRIVATE KEY-----");
}

export const invalidKeyForTests = "-----BEGIN PRIVATE KEY-----\nnot-a-valid-key\n-----END PRIVATE KEY-----";
