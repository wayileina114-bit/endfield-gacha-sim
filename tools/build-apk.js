// build-apk.js - full APK build orchestrator (no Gradle).
// Pipeline: runtime assets -> aapt2 link -> javac -> d8 -> inject dex -> zipalign -> sign.
// Tool locations: JDK (installed via Temurin MSI), Android SDK under %LOCALAPPDATA%\Android\Sdk.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const AND = path.join(ROOT, 'android');
// aapt2 等原生工具对中文路径不友好：全部构建在 ASCII 舞台目录进行
const STAGE = path.join(process.env.USERPROFILE, '.endfield-android', 'apkbuild');
const BUILD = STAGE;
const SDK = path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk');
const BT = path.join(SDK, 'build-tools', '35.0.0');
const PLATFORM = path.join(SDK, 'platforms', 'android-35', 'android.jar');
const AAPT2 = path.join(BT, 'aapt2.exe');
const ZIPALIGN = path.join(BT, 'zipalign.exe');
const D8JAR = path.join(BT, 'lib', 'd8.jar');
const APKSIGNER_JAR = path.join(BT, 'lib', 'apksigner.jar');

// locate newest installed JDK
const ADOPTIUM = 'C:\\Program Files\\Eclipse Adoptium';
const JDK = fs.readdirSync(ADOPTIUM).filter(d => d.startsWith('jdk-')).sort().pop();
if (!JDK) throw new Error('no JDK found in ' + ADOPTIUM);
const JAVA = path.join(ADOPTIUM, JDK, 'bin', 'java.exe');
const JAVAC = path.join(ADOPTIUM, JDK, 'bin', 'javac.exe');
const KEYTOOL = path.join(ADOPTIUM, JDK, 'bin', 'keytool.exe');
console.log('JDK:', JDK);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) {
    console.error('FAILED:', cmd, args.join(' '));
    console.error((r.stdout || '').toString().slice(0, 4000));
    console.error((r.stderr || '').toString().slice(0, 4000));
    process.exit(1);
  }
  return r;
}

/* 0. runtime assets */
run(process.execPath, [path.join(__dirname, 'build-apk-runtime.js')], { cwd: ROOT, encoding: 'utf8' });
if (!fs.existsSync(path.join(SDK, 'platforms', 'android-35'))) { console.error('SDK platform missing - run sdkmanager first'); process.exit(1); }
if (!fs.existsSync(PLATFORM)) { console.error('android.jar missing'); process.exit(1); }

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(path.join(BUILD, 'classes'), { recursive: true });
fs.mkdirSync(path.join(BUILD, 'dex'), { recursive: true });
fs.mkdirSync(path.join(BUILD, 'java'), { recursive: true });
// stage manifest + assets + java sources (ASCII-only paths)
fs.cpSync(path.join(AND, 'AndroidManifest.xml'), path.join(STAGE, 'AndroidManifest.xml'));
fs.cpSync(path.join(AND, 'assets'), path.join(STAGE, 'assets'), { recursive: true });
fs.cpSync(path.join(AND, 'java'), path.join(STAGE, 'java'), { recursive: true });
if (fs.existsSync(path.join(AND, 'res'))) fs.cpSync(path.join(AND, 'res'), path.join(STAGE, 'res'), { recursive: true });

/* 1. aapt2 compile resources (mipmap icons) + link: manifest + res + assets -> unsigned base apk */
const resZip = path.join(BUILD, 'res.zip');
if (fs.existsSync(path.join(STAGE, 'res'))) {
  run(AAPT2, ['compile', '--dir', path.join(STAGE, 'res'), '-o', resZip]);
}
const baseApk = path.join(BUILD, 'base.apk');
const linkArgs = ['link',
  '-I', PLATFORM,
  '--manifest', path.join(STAGE, 'AndroidManifest.xml'),
  '-A', path.join(STAGE, 'assets'),
  '--min-sdk-version', '24',
  '--target-sdk-version', '35',
  '--version-code', '1',
  '--version-name', '1.0.0',
  '--auto-add-overlay'];
if (fs.existsSync(resZip)) linkArgs.push(resZip); // 编译好的图标资源
linkArgs.push('-o', baseApk);
run(AAPT2, linkArgs);
console.log('aapt2 link ok');

/* 2. javac (JDK 25 may have dropped -source 8: fall back to 11 then 17) */
const srcDir = path.join(STAGE, 'java');
const javaFiles = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.java')) javaFiles.push(p); } })(srcDir);
let javacOk = false;
for (const v of ['8', '11', '17']) {
  const r = spawnSync(JAVAC, ['-source', v, '-target', v, '-nowarn', '-classpath', PLATFORM, '-d', path.join(BUILD, 'classes'), ...javaFiles], { encoding: 'utf8' });
  if (r.status === 0) { console.log(`javac ok (source ${v})`); javacOk = true; break; }
  console.log(`javac source ${v} unavailable, trying next`);
}
if (!javacOk) { console.error('javac failed for all source levels'); process.exit(1); }

/* 3. d8 -> classes.dex */
run(JAVA, ['-cp', D8JAR, 'com.android.tools.r8.D8',
  '--release', '--lib', PLATFORM, '--min-api', '24',
  '--output', path.join(BUILD, 'dex'),
  ...fs.readdirSync(path.join(BUILD, 'classes')).length ? walkClasses(path.join(BUILD, 'classes')) : []]);
const dexFile = path.join(BUILD, 'dex', 'classes.dex');
if (!fs.existsSync(dexFile)) { console.error('d8 produced no classes.dex'); process.exit(1); }
console.log('d8 ok');

function walkClasses(d) { const out = []; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) out.push(...walkClasses(p)); else if (e.name.endsWith('.class')) out.push(p); } return out; }

/* 4. inject dex into apk */
run('python', [path.join(__dirname, 'inject-dex.py'), baseApk, dexFile], { encoding: 'utf8' });

/* 5. zipalign */
const aligned = path.join(BUILD, 'aligned.apk');
run(ZIPALIGN, ['-f', '4', baseApk, aligned]);
console.log('zipalign ok');

/* 6. keystore (generate once; persists OUTSIDE the wiped stage dir) */
const ks = path.join(path.dirname(STAGE), 'debug.keystore');
if (!fs.existsSync(ks)) {
  run(KEYTOOL, ['-genkeypair', '-keystore', ks, '-alias', 'endfield',
    '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
    '-storepass', 'endfield123', '-keypass', 'endfield123',
    '-dname', 'CN=Endfield Gacha Sim']);
  console.log('keystore generated');
}

/* 7. apksigner */
const out = path.join(BUILD, 'endfield-gacha-sim.apk');
fs.rmSync(out, { force: true });
run(JAVA, ['-jar', APKSIGNER_JAR, 'sign',
  '--ks', ks, '--ks-key-alias', 'endfield',
  '--ks-pass', 'pass:endfield123', '--key-pass', 'pass:endfield123',
  '--out', out, aligned]);
console.log('signed:', out);

/* 8. copy back into the repo (non-ASCII dir fine for plain file ops) */
const finalDir = path.join(AND, 'build');
fs.mkdirSync(finalDir, { recursive: true });
fs.copyFileSync(out, path.join(finalDir, 'endfield-gacha-sim.apk'));
console.log('copied to', path.join(finalDir, 'endfield-gacha-sim.apk'));
