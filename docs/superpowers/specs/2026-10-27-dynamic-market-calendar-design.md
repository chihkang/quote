# 可追溯交易日曆

依已核准的年度基準加人工更正方案實作。舊修復 PR #2 與 App PR #10 的發布，和本架構的合併／部署分開處理。

## 選擇

保留 immutable 年度 JSON，使用現有 TW_EOD_R2 保存完整目錄及核准紀錄。每個 invocation 讀取一次，將相同 releases 傳給報價、健康檢查、ingest 與 scheduled。App 沿用 revision/effectiveFrom/sha256/document 契約。R2 讀取或驗證失敗時回報 calendar_source_error，不能靜默退回舊版本。尚未初始化儲存時可使用既有 bundled 基準。

正式設定 CALENDAR_STORAGE_REQUIRED=true，未初始化或目錄遺失時亦 fail closed。Bundled fallback 只供未要求持久化的測試／本機環境；人工初始化入口在首次發布前使用 bundled 作為驗證基準。獨立初始化標記在目錄遺失時阻止重新 bootstrap／revision 倒退。

單靠年度 API 不能涵蓋公告，也含開市列。直接自動發布公告會混淆個股停牌與交易所休市。保留現有 R2，年度完整目錄仍使用現有 ADMIN_REFRESH_TOKEN 管理入口。指定日期的 GitHub Actions workflow 使用待確認、尚未啟用的短效 OIDC 信任；不新增長效 token，不使用 TPEX ingest token。

## 發布與資料安全

人工提交完整目錄、expectedRevision、核准者、理由和官方證據 URLs。驗證日期、覆蓋、SHA256、版本唯一性與 append-only prefix，使用 R2 conditional put 避免併發覆蓋。重送相同內容可安全讀回。核准紀錄保存在同一原子物件，舊版本永不修改。未發布候選沒有執行效力。只接受交易所層級更正，不把缺資料視為休市，不改歷史結算。

GitHub workflow_dispatch 可預覽／設定／撤銷 TW/US 指定市場日期。預設僅預覽；發布需 main、owner actor、指定 workflow 與 expectedRevision。publish job 的 id-token:write 與 Worker exact audience 設定待明確授權，尚未啟用。完整權限與撤銷方式見 ../../market-calendar-publication.md。手機只下載，沒有管理 UI／Keychain／手機憑證。啟動與前景、手動結算強制更新；版本不符快取失效，結算最多重試一次，保留歷史。

## 驗收

測試遠端目錄的路由、健康檢查與排程一致；保留 10/23–26 取 10/22、10/27 收盤後不得使用 10/22 的回歸。拒絕版本重寫、hash 錯誤、倒退 revision、錯誤日期、過大 body、未授權與競爭發布。健康與 collector 分別呈現完整、確認休市、等待發布、來源異常，完整性仍以兩板實際正價格判斷。

官方 PDF 已人工核實 10/23 全日休市；公告列表自動發現來源尚未核實。候選工具只處理明確給定的官方公告，不宣稱完整監控。
