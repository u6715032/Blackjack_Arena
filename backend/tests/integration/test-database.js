// Require an explicit, dedicated test database rather than the application's .env URI.
export function testDatabaseUri() {
  const uri = process.env.MONGODB_TEST_URI;
  if (!uri)
    throw new Error(
      "Set MONGODB_TEST_URI to a dedicated test database; MONGODB_URI is never used for integration tests.",
    );
  const parsed = new URL(uri);
  const database = parsed.pathname.slice(1);
  if (!/^[A-Za-z0-9_-]*test[A-Za-z0-9_-]*$/i.test(database))
    throw new Error(
      "The dedicated database name in MONGODB_TEST_URI must contain 'test'.",
    );
  return uri;
}
