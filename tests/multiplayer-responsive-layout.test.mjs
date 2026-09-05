import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(
  new URL("../app/multiplayer/multiplayer.module.css", import.meta.url),
  "utf8",
);
const clientSource = await readFile(
  new URL("../app/multiplayer/MultiplayerClient.tsx", import.meta.url),
  "utf8",
);
const layoutSource = await readFile(
  new URL("../app/layout.tsx", import.meta.url),
  "utf8",
);
const globalsSource = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `缺少 ${startMarker}`);
  assert.notEqual(end, -1, `缺少 ${endMarker}`);
  return source.slice(start, end);
}

function pxVariable(source, name) {
  const match = source.match(new RegExp(`${name}:\\s*(-?\\d+(?:\\.\\d+)?)px`));
  assert.ok(match, `缺少 ${name}`);
  return Number(match[1]);
}

function optionalPxVariable(source, name) {
  const match = source.match(new RegExp(`${name}:\\s*(-?\\d+(?:\\.\\d+)?)px`));
  return match ? Number(match[1]) : null;
}

function numberVariable(source, name) {
  const match = source.match(new RegExp(`${name}:\\s*(-?\\d+(?:\\.\\d+)?)(?:;|\\s)`));
  assert.ok(match, `缺少 ${name}`);
  return Number(match[1]);
}

function clampPxVwVariable(source, name) {
  const match = source.match(new RegExp(
    `${name}:\\s*clamp\\((\\d+(?:\\.\\d+)?)px,\\s*(\\d+(?:\\.\\d+)?)vw,\\s*(\\d+(?:\\.\\d+)?)px\\)`,
  ));
  assert.ok(match, `缺少 ${name} 的 clamp(px, vw, px)`);
  return { minimum: Number(match[1]), vw: Number(match[2]), maximum: Number(match[3]) };
}

function clampAtWidth(clamp, viewportWidth) {
  return Math.min(clamp.maximum, Math.max(clamp.minimum, viewportWidth * clamp.vw / 100));
}

function aspectRatio(source) {
  const match = source.match(/aspect-ratio:\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  assert.ok(match, "缺少 aspect-ratio");
  return Number(match[1]) / Number(match[2]);
}

function tableWidthFormula(source) {
  const match = source.match(
    /width:\s*min\(calc\((\d+(?:\.\d+)?)vw - (\d+(?:\.\d+)?)px\),\s*calc\((\d+(?:\.\d+)?)dvh - (\d+(?:\.\d+)?)px( - env\(safe-area-inset-bottom\))?\),\s*(\d+(?:\.\d+)?)px\)/,
  );
  assert.ok(match, "缺少横屏牌桌 width:min(vw,dvh,max) 公式");
  return {
    viewportPercent: Number(match[1]),
    horizontalReserve: Number(match[2]),
    heightFactor: Number(match[3]),
    verticalReserve: Number(match[4]),
    subtractsSafeBottom: Boolean(match[5]),
    maximum: Number(match[6]),
  };
}

function tableWidthAtViewport(formula, width, height, safeBottom = 0) {
  return Math.min(
    width * formula.viewportPercent / 100 - formula.horizontalReserve,
    height * formula.heightFactor / 100 - formula.verticalReserve
      - (formula.subtractsSafeBottom ? safeBottom : 0),
    formula.maximum,
  );
}

function seatPoint(source, seat) {
  const match = source.match(new RegExp(
    `\\.multiplayerPage \\.seat${seat},[\\s\\S]*?--seat-x:\\s*(-?\\d+(?:\\.\\d+)?)%;\\s*--seat-y:\\s*(-?\\d+(?:\\.\\d+)?)%`,
  ));
  assert.ok(match, `缺少 seat${seat} 的紧凑轨道坐标`);
  return { x: Number(match[1]) / 100, y: Number(match[2]) / 100 };
}

const responsiveLanes = sourceBetween(
  css,
  "/* Responsive multiplayer card and wager lanes",
  "/* End responsive multiplayer card and wager lanes */",
);
const mobileLanes = sourceBetween(
  responsiveLanes,
  "@media (max-width: 700px) {",
  "@media (min-width: 861px) and (max-height: 760px)",
);
const compactWorkspace = sourceBetween(
  css,
  "/* Compact multiplayer interaction reach",
  "/* End compact multiplayer interaction reach */",
);
const deviceMatrix = sourceBetween(
  css,
  "/* Authoritative multiplayer device matrix",
  "/* End authoritative multiplayer device matrix */",
);
const compactRail = sourceBetween(
  deviceMatrix,
  "/* Compact rails use a small but legible seat primitive",
  "/* Tablets retain a generous rail",
);
const portraitPhone = sourceBetween(
  deviceMatrix,
  "@media (max-width: 700px) and (orientation: portrait) {",
  "/* Short portrait phones need a scrollable replay canvas",
);
const shortPortraitHistory = sourceBetween(
  deviceMatrix,
  "/* Short portrait phones need a scrollable replay canvas",
  "/* Landscape phones, foldables",
);
const landscapePhone = sourceBetween(
  deviceMatrix,
  "@media (max-width: 1100px) and (max-height: 700px) and (orientation: landscape) {",
  "/* Compact desktop windows",
);
const shortLandscapeHistory = sourceBetween(
  deviceMatrix,
  "/* A short landscape history viewer",
  "/* Compact desktop windows",
);
const portraitNormalTable = sourceBetween(
  portraitPhone,
  "  .multiplayerPage .tableViewport .pokerTable {",
  "  .multiplayerPage .tableViewport .pokerTable[data-table-size=\"7\"]",
);
const portraitDenseTable = sourceBetween(
  portraitPhone,
  "  .multiplayerPage .tableViewport .pokerTable[data-table-size=\"7\"]",
  "  .multiplayerPage .pokerTable .seat {",
);
const portraitSeatBase = sourceBetween(
  portraitPhone,
  "  .multiplayerPage .pokerTable .seat {",
  "  .multiplayerPage .pokerTable .seatSelf {",
);
const portraitSeatSelf = sourceBetween(
  portraitPhone,
  "  .multiplayerPage .pokerTable .seatSelf {",
  "  .multiplayerPage .pokerTable[data-table-size=\"7\"] .seat:not(.seatSelf)",
);
const portraitSeatDense = sourceBetween(
  portraitPhone,
  "  .multiplayerPage .pokerTable[data-table-size=\"7\"] .seat:not(.seatSelf)",
  "  .tableActionCluster {",
);
const landscapeNormalTable = sourceBetween(
  landscapePhone,
  "  .multiplayerPage .tableViewport .pokerTable {",
  "  .multiplayerPage .tableViewport .pokerTable .boardArea {",
);
const landscapeDenseTable = sourceBetween(
  landscapePhone,
  "  .multiplayerPage .tableViewport .pokerTable[data-table-size=\"7\"]",
  "  .multiplayerPage .pokerTable .seat {",
);
const landscapeSeatBase = sourceBetween(
  landscapePhone,
  "  .multiplayerPage .pokerTable .seat {",
  "  .multiplayerPage .pokerTable .seatSelf {",
);
const landscapeSeatSelf = sourceBetween(
  landscapePhone,
  "  .multiplayerPage .pokerTable .seatSelf {",
  "  .multiplayerPage .pokerTable[data-table-size=\"7\"] .seat:not(.seatSelf)",
);
const landscapeSeatDense = sourceBetween(
  landscapePhone,
  "  .multiplayerPage .pokerTable[data-table-size=\"7\"] .seat:not(.seatSelf)",
  "  .multiplayerPage .pokerTable .seatIdentity > span",
);

test("mobile multiplayer card rows fit the narrowest supported table", () => {
  const viewportWidth = 320;
  const tableWidth = Math.min(420, viewportWidth - 64);
  const normalCardWidth = clampAtWidth(
    clampPxVwVariable(portraitNormalTable, "--mp-board-card-width"),
    viewportWidth,
  );
  const denseCardWidth = clampAtWidth(
    clampPxVwVariable(portraitDenseTable, "--mp-board-card-width"),
    viewportWidth,
  );
  const normalGap = pxVariable(portraitNormalTable, "--mp-board-card-gap");
  const denseGap = optionalPxVariable(portraitDenseTable, "--mp-board-card-gap") ?? normalGap;
  const normalRowWidth = normalCardWidth * 5 + normalGap * 4;
  const denseRowWidth = denseCardWidth * 5 + denseGap * 4;

  assert.ok(normalRowWidth <= tableWidth - 24, "普通手机桌公共牌应保留两侧安全区");
  assert.ok(denseRowWidth <= tableWidth - 24, "十人手机桌公共牌应保留两侧安全区");
});

test("mobile wager lanes clear hole cards with a four-digit chip label", () => {
  const holeCardWidth = pxVariable(mobileLanes, "--mp-hole-card-width");
  const holeCardGap = 5;
  const holeGroupHalfWidth = (holeCardWidth * 2 + holeCardGap) / 2;
  const conservativeBetLabelHalfWidth = 29;
  const lowerDiagonalX = pxVariable(mobileLanes, "--mp-wager-lower-diagonal-x");
  const upperDiagonalX = pxVariable(mobileLanes, "--mp-wager-upper-diagonal-x");
  const sideX = pxVariable(mobileLanes, "--mp-wager-side-x");

  for (const [lane, offset] of [
    ["下斜角", lowerDiagonalX],
    ["上斜角", upperDiagonalX],
    ["左右侧", sideX],
  ]) {
    const clearance = offset - holeGroupHalfWidth - conservativeBetLabelHalfWidth;
    assert.ok(clearance >= 8, `${lane}下注与两张底牌至少保留 8px 未缩放间距`);
  }
});

test("mobile top and hero wager lanes retain vertical card clearance", () => {
  const panelHalfHeight = 24;
  const conservativeBetLabelHalfHeight = 9;
  const holeCardBottom = Math.abs(pxVariable(mobileLanes, "--mp-hole-card-bottom"));
  const heroCardTop = pxVariable(mobileLanes, "--mp-hero-card-top");
  const topWagerY = pxVariable(mobileLanes, "--mp-wager-top-y");
  const bottomWagerY = pxVariable(mobileLanes, "--mp-wager-bottom-y");

  const topClearance =
    topWagerY - conservativeBetLabelHalfHeight - (panelHalfHeight + holeCardBottom);
  const heroClearance =
    heroCardTop - panelHalfHeight - (bottomWagerY + conservativeBetLabelHalfHeight);

  assert.ok(topClearance >= 5, "顶部下注应与向下展开的底牌至少相隔 5px");
  assert.ok(heroClearance >= 5, "英雄下注应与向上展开的底牌至少相隔 5px");
});

test("320px two- and ten-player tables keep the board between both wager lanes", () => {
  const tableWidth = 320 - 64;
  const panelHalfHeight = 24;
  const betHalfHeight = 9;
  const heroScale = numberVariable(portraitSeatSelf, "--seat-scale");
  const holeCardBottom = Math.abs(pxVariable(mobileLanes, "--mp-hole-card-bottom"));
  const heroCardTop = pxVariable(mobileLanes, "--mp-hero-card-top");
  const topWagerY = pxVariable(mobileLanes, "--mp-wager-top-y");
  const bottomWagerY = pxVariable(mobileLanes, "--mp-wager-bottom-y");
  const lowerSideWagerY = pxVariable(mobileLanes, "--mp-wager-side-lower-y");
  const upperSideWagerY = pxVariable(mobileLanes, "--mp-wager-side-upper-y");

  for (const scenario of [
    {
      label: "两人桌",
      aspectRatio: aspectRatio(portraitNormalTable),
      boardCardWidth: clampAtWidth(clampPxVwVariable(portraitNormalTable, "--mp-board-card-width"), 320),
      opponentScale: numberVariable(portraitSeatBase, "--seat-scale"),
    },
    {
      label: "十人桌",
      aspectRatio: aspectRatio(portraitDenseTable),
      boardCardWidth: clampAtWidth(clampPxVwVariable(portraitDenseTable, "--mp-board-card-width"), 320),
      opponentScale: numberVariable(portraitSeatDense, "--seat-scale"),
    },
  ]) {
    const tableHeight = tableWidth / scenario.aspectRatio;
    const boardCardHeight = scenario.boardCardWidth / 0.7;
    const boardGridHeight = 15 + 18 + boardCardHeight;
    const boardTop = tableHeight * 0.45 - boardGridHeight / 2;
    const boardBottom = boardTop + boardGridHeight;
    const topSeatCenter = tableHeight * seatPoint(compactRail, 5).y;
    const upperSideSeatCenter = tableHeight * seatPoint(compactRail, 3).y;
    const lowerSideSeatCenter = tableHeight * seatPoint(compactRail, 2).y;
    const heroSeatCenter = tableHeight * seatPoint(compactRail, 0).y;
    const topCardsBottom =
      topSeatCenter + scenario.opponentScale * (panelHalfHeight + holeCardBottom);
    const topBetStart =
      topSeatCenter + scenario.opponentScale * (topWagerY - betHalfHeight);
    const topBetEnd =
      topSeatCenter + scenario.opponentScale * (topWagerY + betHalfHeight);
    const heroBetStart = heroSeatCenter + heroScale * (bottomWagerY - betHalfHeight);
    const heroBetEnd = heroSeatCenter + heroScale * (bottomWagerY + betHalfHeight);
    const heroCardsTop = heroSeatCenter + heroScale * (heroCardTop - panelHalfHeight);
    const upperSideBetEnd =
      upperSideSeatCenter + scenario.opponentScale * (upperSideWagerY + betHalfHeight);
    const lowerSideBetStart =
      lowerSideSeatCenter + scenario.opponentScale * (lowerSideWagerY - betHalfHeight);

    assert.ok(
      topBetStart - topCardsBottom >= 4,
      `${scenario.label}顶部底牌与下注轨道应留出视觉间距`,
    );
    assert.ok(
      boardTop - topBetEnd >= 4,
      `${scenario.label}顶部下注轨道不应进入底池和公共牌区域`,
    );
    assert.ok(
      heroBetStart - boardBottom >= 4,
      `${scenario.label}英雄下注轨道不应进入公共牌区域`,
    );
    assert.ok(
      heroCardsTop - heroBetEnd >= 4,
      `${scenario.label}英雄下注轨道不应进入自己的底牌区域`,
    );
    assert.ok(
      boardTop - upperSideBetEnd >= 4,
      `${scenario.label}上层侧座下注轨道不应进入公共牌区域`,
    );
    assert.ok(
      lowerSideBetStart - boardBottom >= 4,
      `${scenario.label}下层侧座下注轨道不应进入公共牌区域`,
    );
  }
});

test("flowing phone and tablet layouts auto-reveal the action row once per decision", () => {
  assert.match(clientSource, /const primaryActionsRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(clientSource, /lastAutoFocusedDecisionRef\.current === aiDecisionId/);
  assert.match(clientSource, /matchMedia\("\(max-width: 1100px\)"\)/);
  assert.match(clientSource, /matchMedia\("\(orientation: landscape\) and \(max-height: 700px\)"\)/);
  assert.match(clientSource, /splitLandscape\.addEventListener\("change", revealActions\)/);
  assert.match(clientSource, /requestAnimationFrame\(\(\) => \{[\s\S]*?lastAutoFocusedDecisionRef\.current = aiDecisionId;[\s\S]*?scrollIntoView/);
  assert.match(clientSource, /primaryActionsRef\.current\?\.scrollIntoView\(\{[\s\S]*?block: "center"/);
  assert.match(clientSource, /prefers-reduced-motion: reduce/);
  assert.match(clientSource, /<div ref=\{primaryActionsRef\} className=\{styles\.primaryActions\}/);
});

test("compact desktop table keeps local interaction controls near the first viewport", () => {
  assert.match(compactWorkspace, /margin-top:\s*56px/);
  assert.match(compactWorkspace, /padding:\s*70px 82px 72px/);
  assert.match(compactWorkspace, /100dvh - 410px/);

  for (const scenario of [
    { width: 1_366, height: 768 },
    { width: 1_440, height: 900 },
  ]) {
    const tableWidth = Math.min(
      1_080,
      scenario.width - 220,
      Math.max(620, (scenario.height - 410) * 2.05),
    );
    const tableHeight = tableWidth / 2.05;
    const talkRailTop = 72 + 56 + 70 + tableHeight + 72;
    const remainingViewport = scenario.height - talkRailTop;

    assert.ok(
      remainingViewport >= 132,
      `${scenario.width}×${scenario.height} 应在首屏容纳表情栏和紧凑下注台`,
    );
  }
});

test("the final device matrix owns touch targets and uses valid viewport arithmetic", () => {
  assert.ok(
    css.indexOf("/* Authoritative multiplayer device matrix")
      > css.indexOf("/* Compact multiplayer interaction reach"),
    "设备矩阵必须位于历史媒体查询之后",
  );
  assert.match(
    deviceMatrix,
    /@media \(pointer: coarse\), \(max-width: 700px\)[\s\S]*?\.replayTransport > button[\s\S]*?min-height:\s*40px/,
  );
  assert.match(deviceMatrix, /\.tableHomeButton,[\s\S]*?\.historyHeaderMeta button[\s\S]*?width:\s*40px;[\s\S]*?height:\s*40px/);
  assert.match(deviceMatrix, /\.field input,[\s\S]*?\.chatComposer input,[\s\S]*?\.raiseNumberField input\s*\{[\s\S]*?font-size:\s*16px/);
  assert.match(deviceMatrix, /max\(620px, calc\(205dvh - 841px\)\)/);
  assert.doesNotMatch(deviceMatrix, /calc\([^\n)]*\*/);
});

test("installed phones reserve every safe area including the translucent status bar", () => {
  assert.match(layoutSource, /viewportFit:\s*"cover"/);
  for (const lane of [portraitPhone, landscapePhone]) {
    assert.match(lane, /padding:\s*env\(safe-area-inset-top\)[^;]*env\(safe-area-inset-right\)[^;]*env\(safe-area-inset-left\)/);
    assert.match(lane, /env\(safe-area-inset-bottom\)/);
  }
  assert.match(portraitPhone, /top:\s*calc\(60px \+ env\(safe-area-inset-top\)\)/);
  assert.match(portraitPhone, /\.historyOverlay\s*\{[\s\S]*?padding:\s*env\(safe-area-inset-top\)[^;]*env\(safe-area-inset-bottom\)/);
  assert.match(landscapePhone, /top:\s*max\(4px, env\(safe-area-inset-top\)\)/);
  assert.match(globalsSource, /\.modal-backdrop\s*\{[^}]*padding:\s*max\(24px, env\(safe-area-inset-top\)\)[^;]*env\(safe-area-inset-right\)[^;]*env\(safe-area-inset-bottom\)[^;]*env\(safe-area-inset-left\)/);
  assert.match(globalsSource, /@media \(max-width: 640px\)[\s\S]*?\.poker-rules-toolbar \.modal-close\s*\{[^}]*width:\s*44px;\s*height:\s*44px/);
  assert.match(globalsSource, /@media \(max-width: 640px\)[\s\S]*?\.modal-backdrop\s*\{[^}]*padding:\s*max\(10px, env\(safe-area-inset-top\)\)[^;]*env\(safe-area-inset-left\)/);
  assert.match(globalsSource, /\.poker-rules-modal\s*\{[^}]*max-height:\s*calc\(100dvh - max\(24px, env\(safe-area-inset-top\)\) - max\(24px, env\(safe-area-inset-bottom\)\)\)/);
});

test("portrait phones reserve enough height for ten seats before the action dock", () => {
  assert.match(portraitPhone, /min-height:\s*clamp\(460px, calc\(100vw \+ 145px\), 640px\)/);
  assert.match(portraitPhone, /padding:\s*64px 24px 88px/);
  assert.match(portraitPhone, /width:\s*min\(420px, calc\(100vw - 64px\)\)/);
  assert.match(portraitPhone, /data-table-size="10"[\s\S]*?aspect-ratio:\s*0\.88 \/ 1/);
  assert.match(portraitPhone, /\.tableActionCluster\s*\{[\s\S]*?width:\s*100%/);
  assert.match(portraitPhone, /\.chatDock,[\s\S]*?position:\s*fixed;[\s\S]*?bottom:\s*0/);

  for (const viewportWidth of [320, 390, 480, 700]) {
    const tableWidth = Math.min(420, viewportWidth - 64);
    const denseTableHeight = tableWidth / 0.88;
    const reservedTableHeight = 64 + denseTableHeight + 88;
    const tableViewportHeight = Math.min(640, Math.max(460, viewportWidth + 145));
    assert.ok(
      reservedTableHeight <= tableViewportHeight + 0.01,
      `${viewportWidth}px 竖屏十人桌和外伸座位必须完整落在桌区内`,
    );
  }
});

test("short landscape phones split table and controls into independent safe panes", () => {
  assert.match(
    landscapePhone,
    /grid-template-columns:\s*minmax\(0, 62fr\) minmax\(0, 38fr\)/,
  );
  assert.match(landscapePhone, /height:\s*calc\(100dvh - 48px - env\(safe-area-inset-top\)\)/);
  assert.match(landscapePhone, /padding:\s*22px 30px 32px/);
  assert.match(landscapePhone, /155dvh - 274px - env\(safe-area-inset-bottom\)/);
  assert.match(landscapePhone, /--mp-board-card-width:\s*clamp\(24px, 4\.2vw, 31px\)/);
  assert.match(landscapePhone, /--mp-board-card-gap:\s*2px/);
  assert.match(landscapePhone, /\.boardArea\s*\{[\s\S]*?top:\s*45%;[\s\S]*?gap:\s*10px/);
  assert.match(
    landscapePhone,
    /\.tableActionCluster\s*\{[\s\S]*?grid-column:\s*2;[\s\S]*?overflow-y:\s*auto/,
  );
  assert.match(
    landscapePhone,
    /\.tableActionCluster \.waitingControls\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) !important/,
  );
  assert.match(
    landscapePhone,
    /\.chatDock,[\s\S]*?width:\s*min\(360px, calc\(38vw - 12px - env\(safe-area-inset-right\)\)\)[\s\S]*?right:\s*max\(4px, env\(safe-area-inset-right\)\)/,
  );
  assert.match(landscapePhone, /\.tableControlsTransition\s*\{[\s\S]*?max-height:\s*none;[\s\S]*?overflow:\s*visible/);

  const normalAspectRatio = aspectRatio(landscapeNormalTable);
  const denseAspectRatio = aspectRatio(landscapeDenseTable);
  const normalWidthFormula = tableWidthFormula(landscapeNormalTable);
  const denseWidthFormula = tableWidthFormula(landscapeDenseTable);
  const normalBoardClamp = clampPxVwVariable(landscapeNormalTable, "--mp-board-card-width");
  const denseBoardClamp = clampPxVwVariable(landscapeDenseTable, "--mp-board-card-width");
  const boardGap = pxVariable(landscapeNormalTable, "--mp-board-card-gap");
  const topWagerY = pxVariable(landscapeNormalTable, "--mp-wager-top-y");
  const upperWagerY = pxVariable(landscapeNormalTable, "--mp-wager-upper-diagonal-y");
  const sideUpperWagerY = pxVariable(landscapeNormalTable, "--mp-wager-side-upper-y");
  const bottomWagerY = pxVariable(landscapeNormalTable, "--mp-wager-bottom-y");
  const lowerWagerY = pxVariable(landscapeNormalTable, "--mp-wager-lower-diagonal-y");
  const sideLowerWagerY = pxVariable(landscapeNormalTable, "--mp-wager-side-lower-y");
  const normalOpponentScale = numberVariable(landscapeSeatBase, "--seat-scale");
  const denseOpponentScale = numberVariable(landscapeSeatDense, "--seat-scale");
  const heroScale = numberVariable(landscapeSeatSelf, "--seat-scale");

  for (const { width, height } of [
    { width: 480, height: 320 },
    { width: 568, height: 320 },
    { width: 667, height: 375 },
    { width: 844, height: 390 },
    { width: 1024, height: 600 },
    { width: 1100, height: 700 },
  ]) {
    const normalTableWidth = tableWidthAtViewport(normalWidthFormula, width, height);
    const denseTableWidth = tableWidthAtViewport(denseWidthFormula, width, height);
    const stageInnerWidth = width - 12 - 6;
    const leftPaneWidth = stageInnerWidth * 0.62;
    const rightPaneWidth = stageInnerWidth * 0.38;
    const innerRailHeight = height - 48 - 50 - 5 - 22 - 32;
    const normalBoardCardWidth = clampAtWidth(normalBoardClamp, width);
    const denseBoardCardWidth = clampAtWidth(denseBoardClamp, width);
    const normalBoardWidth = normalBoardCardWidth * 5 + boardGap * 4;
    const denseBoardWidth = denseBoardCardWidth * 5 + boardGap * 4;

    assert.ok(normalTableWidth / normalAspectRatio <= innerRailHeight + 8, `${width}×${height} 普通桌只允许使用预留的外伸座位带`);
    assert.ok(denseTableWidth / denseAspectRatio <= innerRailHeight + 8, `${width}×${height} 十人桌只允许使用预留的外伸座位带`);
    assert.ok(normalTableWidth <= leftPaneWidth - 60 + 0.01, `${width}×${height} 普通桌应落在左侧安全栏内`);
    assert.ok(denseTableWidth <= leftPaneWidth - 60 + 0.01, `${width}×${height} 十人桌应落在左侧安全栏内`);
    assert.ok(rightPaneWidth >= 170, `${width}×${height} 右侧操作栏至少保留 170px`);
    assert.ok(normalBoardWidth <= normalTableWidth - 24, `${width}×${height} 普通桌五张公共牌应横向放得下`);
    assert.ok(denseBoardWidth <= denseTableWidth - 24, `${width}×${height} 十人桌五张公共牌应横向放得下`);

    for (const [tableKind, tableWidth, aspectRatio, cardWidth, opponentScale] of [
      ["普通桌", normalTableWidth, normalAspectRatio, normalBoardCardWidth, normalOpponentScale],
      ["十人桌", denseTableWidth, denseAspectRatio, denseBoardCardWidth, denseOpponentScale],
    ]) {
      const tableHeight = tableWidth / aspectRatio;
      const boardCenter = tableHeight * 0.45;
      const cardHeight = cardWidth / 0.7;
      const potLineHeight = 12;
      const boardContentGap = 10;
      const boardTop = boardCenter + (potLineHeight + boardContentGap - cardHeight) / 2;
      const boardBottom = boardCenter + (potLineHeight + boardContentGap + cardHeight) / 2;
      const wagerHalfHeight = 9;

      const upperWagerCenters = [
        seatPoint(compactRail, 5).y * tableHeight + topWagerY * opponentScale,
        seatPoint(compactRail, 4).y * tableHeight + upperWagerY * opponentScale,
        seatPoint(compactRail, 3).y * tableHeight + sideUpperWagerY * opponentScale,
      ];
      const lowerWagerCenters = [
        seatPoint(compactRail, 0).y * tableHeight + bottomWagerY * heroScale,
        seatPoint(compactRail, 1).y * tableHeight - lowerWagerY * opponentScale,
        seatPoint(compactRail, 2).y * tableHeight + sideLowerWagerY * opponentScale,
      ];
      const upperClearance = boardTop - (Math.max(...upperWagerCenters) + wagerHalfHeight);
      const lowerClearance = Math.min(...lowerWagerCenters) - wagerHalfHeight - boardBottom;
      assert.ok(upperClearance >= 4, `${width}×${height} ${tableKind}顶部下注与公共牌仅余 ${upperClearance}px`);
      assert.ok(lowerClearance >= 4, `${width}×${height} ${tableKind}底部下注与公共牌仅余 ${lowerClearance}px`);
    }
  }

  for (const safeBottom of [21, 34]) {
    const width = 844;
    const height = 390;
    const denseTableWidth = tableWidthAtViewport(denseWidthFormula, width, height, safeBottom);
    const tableHeight = denseTableWidth / denseAspectRatio;
    const innerRailHeight = height - 48 - 50 - safeBottom - 22 - 32;
    assert.ok(tableHeight <= innerRailHeight + 8, `底部安全区 ${safeBottom}px 时牌桌只允许使用外伸座位带`);
  }
});

test("compact ten-seat rail keeps adjacent panels separate and text legible", () => {
  assert.match(compactRail, /\.seatIdentity strong\s*\{[\s\S]*?font-size:\s*18px/);
  assert.match(compactRail, /\.seatClock strong\s*\{[\s\S]*?font-size:\s*20px/);
  assert.match(compactRail, /\.playerPanel\s*\{[\s\S]*?width:\s*100%[\s\S]*?grid-template-columns:\s*24px minmax\(0, 1fr\) auto/);
  assert.match(compactRail, /\.seatStackFull\s*\{[\s\S]*?display:\s*none/);
  assert.match(compactRail, /\.seatStackCompact\s*\{[\s\S]*?display:\s*inline/);
  assert.match(compactRail, /\.seatMessageBubble\s*\{[\s\S]*?font-size:\s*18px/);
  assert.match(compactRail, /data-table-size="10"\]\) \.seat:not\(\.seatSelf\) \.avatar[\s\S]*?display:\s*none/);
  assert.match(clientSource, /function compactChipCount\([\s\S]*?return `\$\{Math\.round\(stack \/ 1_000\)\}K`/);
  assert.match(clientSource, /className=\{styles\.seatStackCompact\}[\s\S]*?compactChipCount\(player\.stack\)/);
  const rawHeroPanelWidth = pxVariable(compactRail, "--mp-compact-seat-width");
  const rawDensePanelWidth = pxVariable(compactRail, "--mp-compact-dense-seat-width");
  const points = Array.from({ length: 10 }, (_, seat) => seatPoint(compactRail, seat));
  for (const { width, height, tableWidth, tableRatio, denseScale, heroScale } of [
    {
      width: 320,
      height: 568,
      tableWidth: Math.min(420, 320 - 64),
      tableRatio: aspectRatio(portraitDenseTable),
      denseScale: numberVariable(portraitSeatDense, "--seat-scale"),
      heroScale: numberVariable(portraitSeatSelf, "--seat-scale"),
    },
    {
      width: 480,
      height: 320,
      tableWidth: tableWidthAtViewport(tableWidthFormula(landscapeDenseTable), 480, 320),
      tableRatio: aspectRatio(landscapeDenseTable),
      denseScale: numberVariable(landscapeSeatDense, "--seat-scale"),
      heroScale: numberVariable(landscapeSeatSelf, "--seat-scale"),
    },
  ]) {
    const tableHeight = tableWidth / tableRatio;
    for (let seat = 0; seat < points.length; seat += 1) {
      const next = (seat + 1) % points.length;
      const distance = Math.hypot(
        (points[seat].x - points[next].x) * tableWidth,
        (points[seat].y - points[next].y) * tableHeight,
      );
      const currentWidth = (seat === 0 ? rawHeroPanelWidth : rawDensePanelWidth) * (seat === 0 ? heroScale : denseScale);
      const nextWidth = (next === 0 ? rawHeroPanelWidth : rawDensePanelWidth) * (next === 0 ? heroScale : denseScale);
      assert.ok(
        distance + 0.25 >= (currentWidth + nextWidth) / 2,
        `${width}×${height} seat${seat}/seat${next} 面板重叠`,
      );
    }
    assert.ok(18 * denseScale >= 9, `${width}×${height} 对手昵称实际字号不应小于 9px`);
    assert.ok(20 * denseScale >= 10, `${width}×${height} 当前读秒实际字号不应小于 10px`);
  }
});

test("short landscape hand history is closable and owns a reachable replay scroll area", () => {
  assert.match(shortLandscapeHistory, /\.historyDialog\s*\{[\s\S]*?min-height:\s*0/);
  assert.match(shortLandscapeHistory, /\.historyHeader\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(shortLandscapeHistory, /\.replayWorkspace\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(shortLandscapeHistory, /\.replayTable\[data-table-size="10"\][\s\S]*?calc\(\(100dvh - 260px\) \* 2\.05\)[\s\S]*?aspect-ratio:\s*2\.05 \/ 1/);
  assert.match(shortLandscapeHistory, /@media \(max-width: 650px\)[\s\S]*?\.replayContent\s*\{[\s\S]*?overflow:\s*visible/);
  assert.match(shortLandscapeHistory, /@media \(max-width: 650px\)[\s\S]*?\.replayTable\[data-table-size="10"\][\s\S]*?width:\s*min\(300px, calc\(100% - 36px\)\)/);
});

test("short portrait hand history keeps its transport controls reachable", () => {
  assert.match(shortPortraitHistory, /max-height:\s*770px/);
  assert.match(shortPortraitHistory, /\.replayWorkspace\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(shortPortraitHistory, /\.replayContent\s*\{[\s\S]*?min-height:\s*560px[\s\S]*?grid-template-rows:\s*450px 108px[\s\S]*?overflow:\s*visible/);
  assert.match(shortPortraitHistory, /\.replayTableViewport\s*\{[\s\S]*?min-height:\s*0/);
  assert.match(shortPortraitHistory, /\.replayTable\[data-table-size="10"\][\s\S]*?width:\s*min\(250px, calc\(100% - 8px\)\)[\s\S]*?min-width:\s*0/);

  for (const [viewportWidth, viewportHeight] of [[320, 568], [375, 667]]) {
    const dialogHeight = viewportHeight;
    const workspaceHeight = dialogHeight - 60 - 86;
    const workspaceChrome = 8 * 2 + 42 + 7;
    const replayContentHeight = 560;
    const scrollRange = Math.max(0, replayContentHeight - (workspaceHeight - workspaceChrome));
    const tableRowHeight = 450;
    const transportHeight = 54;
    const viewportBoxHeight = tableRowHeight - transportHeight;
    const replayInnerHeight = viewportBoxHeight - 54 - 48;
    const contentWidth = viewportWidth - 8 * 2 - 2;
    const replayViewportInnerWidth = contentWidth - 34 * 2;
    const replayTableWidth = Math.min(250, replayViewportInnerWidth - 8);
    const denseReplayTableHeight = replayTableWidth / 0.96;
    const denseSeatOverhang = 17;
    const transportBottom = workspaceChrome + tableRowHeight;
    assert.ok(
      transportBottom - scrollRange <= workspaceHeight,
      `${viewportHeight}px 高竖屏滚动后必须能看到回放控制条`,
    );
    assert.ok(
      denseReplayTableHeight <= replayInnerHeight,
      `${viewportWidth}×${viewportHeight} 十人回放牌桌必须完整落入内容区`,
    );
    assert.ok(
      denseReplayTableHeight + denseSeatOverhang * 2 <= viewportBoxHeight,
      `${viewportWidth}×${viewportHeight} 十人回放外伸座位必须落入安全内边距`,
    );
  }
});

test("the final device matrix has no phone, foldable or short-tablet coverage gap", () => {
  assert.match(
    deviceMatrix,
    /@media \(min-width: 701px\) and \(max-width: 1100px\) and \(min-height: 701px\)/,
  );
  assert.match(
    deviceMatrix,
    /@media \(max-width: 1100px\) and \(max-height: 700px\) and \(orientation: landscape\)/,
  );

  const route = (width, height) => {
    const portrait = height >= width;
    if (width <= 700 && portrait) return "portrait-phone";
    if (width <= 1100 && height <= 700 && !portrait) return "landscape-compact";
    if (width >= 701 && width <= 1100 && height >= 701) return "tablet";
    if (width >= 1101 && height <= 760) return "compact-desktop";
    return "desktop";
  };
  assert.deepEqual(
    [
      [320, 568],
      [480, 800],
      [568, 320],
      [700, 600],
      [701, 900],
      [1024, 600],
      [1100, 700],
      [1100, 900],
      [1101, 700],
      [1366, 768],
    ].map(([width, height]) => route(width, height)),
    [
      "portrait-phone",
      "portrait-phone",
      "landscape-compact",
      "landscape-compact",
      "tablet",
      "landscape-compact",
      "landscape-compact",
      "tablet",
      "compact-desktop",
      "desktop",
    ],
  );
});
