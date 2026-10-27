# 人工發布交易日曆

本架構的整合、部署與既有日曆初始化已取得授權；限定的 GitHub OIDC 信任亦已另行核准。正式上線狀態仍須以部署、workflow log 與日曆讀回確認。

## 資料與權限

沿用 `TW_EOD_R2`，日曆物件為 `market-calendar/catalog.json`。內容含完整 `{schemaVersion,revision,calendars}` 及 append-only `audit`。每次核准記錄 revision、核准者、時間、理由、官方證據 URL。catalog 內每個 document 的確切 UTF-8 bytes、sha256、effectiveFrom 都保留，不能改寫既有版本。同一個條件寫入原子保存 catalog 與 audit。初始化前先以條件寫入建立 `market-calendar/initialized.json` 標記；目錄遺失而標記仍在時，發布入口也拒絕重新初始化，避免倒退 revision。若初始化在標記與目錄兩次寫入之間中斷，會要求人工復原，不會自動重置歷史。R2 存取設定與管理員 credential 都沿用既有資源。

`/admin/market-calendar/publish` 僅接受現有 `ADMIN_REFRESH_TOKEN` Bearer token。`EOD_INGEST_TOKEN` 不能使用。不要將管理員 token 放入來源碼、CLI 參數、shell history 或候選 artifact；執行端須從既有登入／受控環境提供。

## 手機可操作的 GitHub 入口

`.github/workflows/manage-market-calendar.yml` 提供 `workflow_dispatch`：選 TW 或 US、輸入市場當地日期（YYYY-MM-DD）、close／reopen 與原因。預設 `publish=false`，只讀取目前日曆並預覽預期收盤來源日。確認後重新執行並勾選 publish。只在 main 發布；前置 preview revision 與實際發布時不同會停止，必須重新預覽。

close 僅影響該市場的指定日期；reopen 只撤銷人工加入的休市，不能刪除年度官方休市。重複 close 不追加紀錄；撤銷後再次撤銷會明確拒絕。新版本也更新已排定的未來 snapshot，避免到未來生效日又恢復錯誤規則；保留所有舊 document 與 audit。半日交易被人工改為全日休市後，撤銷會還原原先收盤時間。

workflow 發布使用**另行核准的 OIDC 信任**，不複製現有完整管理 token 到 GitHub，不建立手機或長效 secret。GitHub 可為具 `id-token: write` 的 job 簽發短效身分 token；本 Worker 再限縮可執行的操作（[GitHub OIDC 契約](https://docs.github.com/en/actions/reference/security/oidc)）。核准需求一次列明：

- 僅 publish job 新增 `id-token: write`；preview 維持 `contents: read`。
- Worker 新增非秘密設定 `CALENDAR_GITHUB_AUDIENCE`，值為正式 origin 的 `/admin/market-calendar/closures` 完整 HTTPS URL。未設定即拒絕所有 OIDC 發布。
- 驗證 GitHub 簽章、issuer、exact audience、repo `chihkang/quote`／ID `1142362573`、owner ID `8790142`、actor `chihkang`／ID `8790142`、main、指定 workflow_ref 及 workflow_dispatch。有效期最多十分鐘。
- 權限只設定／撤銷 TW／US 日期，不能呼叫完整 catalog 發布、行情 refresh 或 ingest。audit 的核准者取已簽章 actor/run/attempt，不能由 body 冒充。
- token 僅存在執行中的 job 與 request 記憶體；不寫入檔案、artifact、App、聊天或 log。Worker 透過 GitHub 固定 JWKS URL 驗簽，不儲存金鑰。
- 撤銷方式是移除 Worker audience 設定，立即拒絕後續請求；亦可停用 workflow／移除 job 權限。沒有待交付或輪替的長效憑證。

此權限與架構整合／部署／既有日曆初始化已分別獲准；不得擴張 actor、repo、branch、workflow 或管理操作。現有 `ADMIN_REFRESH_TOKEN` 保留原有完整管理能力，但 workflow 不持有或讀取它。全域年度 catalog 發布仍由現有完整管理入口處理。

## 正式啟用順序

1. 確認本架構部署及初始化授權，保留部署前版本。部署設定 `CALENDAR_STORAGE_REQUIRED=true`。此模式在初始化前明確回 503，不能誤用 bundled 舊規則。首次啟用可先以同一版本、暫時 CALENDAR_STORAGE_REQUIRED=false 供應已驗證 bundled 日曆，經 workflow 初始化並讀回後立即切換 true，以縮短不可用窗口；初始化標記存在但 catalog 遺失時，兩種設定都 fail closed。
2. 人工核對 bundled catalog。首次可由既有完整發布入口初始化相同目錄，或由已核准的手動休市 workflow 完成首次發布。只讀 `/market-calendar/bootstrap` 僅在 catalog 與初始化標記從未建立時提供 bundled preview；已有歷史或標記時拒絕 bootstrap。正式儲存缺失、讀取失敗或內容不合法時，health、報價與 catalog 都 fail closed。
3. 之後新增更正只需發布新的 document/version/revision，不需重新部署。發布仍要求人工核准，不從缺價或下載失敗推論休市。
4. 讀回 `/market-calendar`，確認所有 digest 與 revision。查 `/health/eod` 的版本、預期日、兩板正價格數，並查實際 TWSE/TPEX 股票的來源日期。修正日曆和實際歸檔完整是不同驗收項目。
5. 安裝支援動態更新的 App 版本一次；之後每次線上日曆更正無須重新建置或安裝。啟動／前景均強制檢查，手動結算也不受 24 小時節流阻擋。有效日曆版本改變時刷新行情，舊版／無版本快取失效；TW/US pin 同一 snapshot，結算僅在版本改變時最多重新取得一次。下載失敗保留已驗證離線目錄，不改寫既有歷史 evidence。

## 發布 body

`POST /admin/market-calendar/publish`，`Content-Type: application/json`，body：

```json
{
  "expectedRevision": 202602,
  "approvedBy": "人工核准者",
  "reason": "已人工確認交易所全日休市公告",
  "evidenceURLs": ["https://www.twse.com.tw/staticFiles/news/news/tsecnews/8a8216d6a0fa351b01a1638507940202.pdf"],
  "catalog": {
    "schemaVersion": 1,
    "revision": 202603,
    "calendars": []
  }
}
```

範例 `calendars: []` 是結構示意，伺服器會拒絕。實際提交必須包含讀回的所有舊 entry 與追加的新 entry，不能重新格式化舊 document。新 entry 含 effectiveFrom、document 字串及其小寫 SHA256。document 必須符合 App 的來源、日期、排序、上限及半日收盤時間驗證。

指定日期更正保留 sourceTradingDate 與 targetTradingDate。TW batch 在 latest 較新時查詢應取日期的 R2 歸檔；缺少該日價格仍回 unavailable。US 保持 Finnhub 來源與日期，不冒充 TW official_eod；日曆發布不會創造任何價格或歷史結算。

成功回 200。重送相同已發布 catalog 回 `alreadyPublished=true`，不重複 audit。409 表示 expectedRevision 過期或有人同時發布，重新下載並人工核對差異；不要盲目提高 revision。503 或傳輸中斷可能結果不明，先 GET 讀回確認，才決定是否重送。audit 保存在 R2，不公開核准者個資；catalog 的 document.sources 可供用戶追溯證據。

## 候選與官方來源限制

10/23 官方 PDF 已核實全日休市。年度 API 在 10/27 仍缺這一天，也有年初開始交易、春節最後交易等開市列。`classifyAnnualRows` 只分類明確文字，未知行留待審核；它不直接產出正式日曆。年度 API 的週末列不得直接加入 App 的 weekday holiday 集合。

目前尚未驗證可完整發現臨時公告的 TWSE/TPEX 公告列表來源。因此沒有自動輪詢或自動發布。候選 workflow 只下載指定的 exact 官方 HTTPS PDF，限制來源主機、拒絕 redirect、檢查 PDF signature 與 8 MiB 上限，保存原始 bytes 的 SHA256。沒有文字擷取器時 scope 為 unverified。

本機可執行 `node scripts/calendar-candidate.mjs --url '<官方 PDF URL>' --output '<新的輸出資料夾>'`。如有人工核對的 UTF-8 文字，可加 `--text-file '<文字檔>'` 產生日期／範圍提示；該文字不等同 PDF 已由程式驗證。個股停牌、未知／矛盾文字、缺報價、非法日期都不會建立交易所休市日期。候選永遠 `needs_human_approval`、`autoPublish=false`。

## 可觀察狀態

- `marketStatus=confirmed_closed`：已發布日曆判定休市，仍須獨立檢查歸檔。
- `archiveStatus=complete`：當前預期交易日的 TWSE/TPEX 兩板都有正價格。
- `awaiting_publication`：缺少完整歸檔，不是成功。
- `calendar_unavailable`：沒有日曆涵蓋的已完成交易日。
- `calendar_source_error`：日曆儲存缺失、不可讀或未通過驗證，停止報價及收集。

collector 正常輪詢也會印出 archiveComplete、calendarVersion、calendarRevision、expectedTradingDate 和兩板狀態。final check 仍要求兩板完整，錯誤帶上同樣診斷。下載／認證錯誤維持失敗，不會被改成休市。

R2 audit 是應用層 append-only 與 CAS 保護，不是具備外部管理員不可變保證的 WORM 儲存。具有直接 R2 管理權的使用者仍可更改或刪除目錄及初始化標記；兩者同時遭刪除無法與全新儲存區區分。本次不新增 bucket lock、IAM 或稽核服務。
