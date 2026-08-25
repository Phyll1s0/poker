import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(
  new URL("../app/multiplayer/multiplayer.module.css", import.meta.url),
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

test("mobile multiplayer card rows fit the narrowest supported table", () => {
  const viewportWidth = 320;
  const tableWidth = Math.min(330, viewportWidth - 74);
  const normalCardWidth = 38;
  const denseCardWidth = 36;
  const normalRowWidth = normalCardWidth * 5 + 5 * 4;
  const denseRowWidth = denseCardWidth * 5 + 4 * 4;

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
  const tableWidth = 320 - 74;
  const panelHalfHeight = 24;
  const betHalfHeight = 9;
  const heroScale = 0.86;
  const holeCardBottom = Math.abs(pxVariable(mobileLanes, "--mp-hole-card-bottom"));
  const heroCardTop = pxVariable(mobileLanes, "--mp-hero-card-top");
  const topWagerY = pxVariable(mobileLanes, "--mp-wager-top-y");
  const bottomWagerY = pxVariable(mobileLanes, "--mp-wager-bottom-y");
  const lowerSideWagerY = pxVariable(mobileLanes, "--mp-wager-side-lower-y");
  const upperSideWagerY = pxVariable(mobileLanes, "--mp-wager-side-upper-y");

  for (const scenario of [
    { label: "两人桌", aspectRatio: 0.92, boardCardWidth: 38, opponentScale: 0.68 },
    { label: "十人桌", aspectRatio: 0.88, boardCardWidth: 36, opponentScale: 0.62 },
  ]) {
    const tableHeight = tableWidth / scenario.aspectRatio;
    const boardCardHeight = scenario.boardCardWidth / 0.7;
    const boardGridHeight = 15 + 18 + boardCardHeight;
    const boardTop = tableHeight * 0.45 - boardGridHeight / 2;
    const boardBottom = boardTop + boardGridHeight;
    const topSeatCenter = tableHeight * -0.02;
    const upperSideSeatCenter = tableHeight * 0.38;
    const lowerSideSeatCenter = tableHeight * 0.7;
    const heroSeatCenter = tableHeight * 1.03;
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
