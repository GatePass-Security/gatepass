import latestVersion from "latest-version";
import semver from "semver";

import pkg from "../package.json" assert { type: "json" };

export async function checkForUpdate(): Promise<string | null> {
  const published = await latestVersion(pkg.name);
  if (semver.gt(published, pkg.version)) {
    return published;
  }
  return null;
}

checkForUpdate().then((next) => {
  console.log(next ? `update available: ${next}` : "up to date");
});
