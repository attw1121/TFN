# 桿件小幫手

支撐架配置、桿件數量與重量估算的靜態網頁工具。

## 使用方式

下載整個儲存庫後，以現代瀏覽器開啟 `index.html`，即會進入最新的 `autoCount(20190904)_活潑版.html`。也可將儲存庫放在靜態網頁主機上，以 `index.html` 作為入口；不需安裝前端套件或建置。

1. 設定 X、Y 軸間距、支撐範圍及四角高度，執行配置計算。
2. 在單重設定頁調整 20 種桿件單重，可匯出及匯入 JSON 備份。
3. 在 3D 圖面區塊旋轉、縮放、篩選桿件，或匯入逐桿端點 CSV；支援匯出 PNG 與座標 CSV。

開啟 `ACT20261123.html` 並點選「電塔基座支撐」，即可修改從 `範例圖.dxf` 取得的 ① 至 ⑥ 尺寸（mm），即時更新平面圖、剖面圖、3D 模型及 ⑦ 梁全長。按「還原範例」可重新載入預設尺寸。

單重資料儲存在目前瀏覽器的 IndexedDB，不會上傳到伺服器，也不會自動同步至其他瀏覽器或裝置。更換網址或瀏覽器前，可先匯出 JSON 備份。若本機檔案模式不允許資料庫存取，請使用靜態網頁主機開啟。

## 主要檔案

| 檔案 | 用途 |
| --- | --- |
| `index.html` | 最終版入口 |
| `autoCount(20190904)_活潑版.html` | 最新版配置計算與 3D 預覽 |
| `桿件重量修改_活潑版.html` | 最新版單重設定 |
| `ACT20261123.html` | 支撐架桿件計算、桿件資料庫及電塔基座支撐分頁 |
| `tower-foundation.js` | DXF 範例尺寸及參數化幾何 |
| `autocount-theme_活潑版.css` | 最新版樣式 |
| `material-weights_活潑版.js` | 單重資料、驗證與備份 |
| `scaffold-model.js` | 逐桿模型及 CSV 資料處理 |
| `scaffold-viewer3d.js` | 3D 圖面繪製 |
| `scaffold-3d-ui.js` | 3D 操作介面與匯入匯出 |
| `05_1.png` | 四角高度位置示意圖 |

`autoCount(20190904)_優化版.html`、`autoCount(20190904).html` 及對應資源保留供版本比較與既有回歸測試使用；最新入口指向活潑版。

## 測試

安裝 Node.js 後，於儲存庫目錄執行：

```sh
node --test tests/autocount.test.cjs tests/material-weights.test.cjs tests/scaffold-details.test.cjs tests/scaffold-model.test.cjs
```

測試涵蓋配置數量、單重資料驗證、各位置桿件明細、3D 模型與 CSV 匯入匯出。
