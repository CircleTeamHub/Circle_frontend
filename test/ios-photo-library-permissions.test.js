const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readAppConfig() {
  const filePath = path.join(process.cwd(), 'app.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readIosInfoPlist() {
  const filePath = path.join(process.cwd(), 'ios/CircleIM/Info.plist');
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const source = fs.readFileSync(filePath, 'utf8');
  const match = source.match(
    /<key>NSPhotoLibraryUsageDescription<\/key>\s*<string>([^<]+)<\/string>/,
  );

  return {
    NSPhotoLibraryUsageDescription: match?.[1],
  };
}

test('iOS avatar picking declares a photo library usage description', () => {
  const appConfig = readAppConfig();
  const infoPlist = readIosInfoPlist();

  const expoUsageDescription =
    appConfig.expo?.ios?.infoPlist?.NSPhotoLibraryUsageDescription;
  const nativeUsageDescription = infoPlist?.NSPhotoLibraryUsageDescription;

  assert.equal(
    typeof expoUsageDescription,
    'string',
    'app.json must define expo.ios.infoPlist.NSPhotoLibraryUsageDescription',
  );
  assert.match(
    expoUsageDescription,
    /\S/,
    'app.json photo library usage description must not be empty',
  );
  if (infoPlist) {
    assert.equal(
      nativeUsageDescription,
      expoUsageDescription,
      'ios/CircleIM/Info.plist must stay in sync with app.json',
    );
  }
});
