import { expect, it } from 'vitest';
import { createNoticeCandidate, classifyAnnualRows } from '../scripts/calendar-candidate.mjs';

it('keeps opening-day rows out of annual holiday candidates', () => {
  const result = classifyAnnualRows({stat:'ok',fields:['日期','名稱','說明'],data:[
    ['2026-01-02','國曆新年開始交易日','國曆新年開始交易。'],
    ['2026-02-11','農曆春節前最後交易日','農曆春節前最後交易。'],
    ['2026-02-12','市場無交易，僅辦理結算交割作業',''],
    ['2026-10-26','紀念日','補假。'],
    ['2026-07-01','未知規則','']
  ]});
  expect(result.closed.map(row => row.date)).toEqual(['2026-02-12','2026-10-26']);
  expect(result.open.map(row => row.date)).toEqual(['2026-01-02','2026-02-11']);
  expect(result.needsReview.map(row => row.date)).toEqual(['2026-07-01']);
});

it('creates a review-only exchange-wide closure candidate from a specific official notice', async () => {
  const candidate = await createNoticeCandidate({url:'https://www.twse.com.tw/staticFiles/news/fixture.pdf', text:'臺灣證券交易所集中交易市場115年10月23日全日休市', retrievedAt:'2026-10-27T00:00:00Z'});
  expect(candidate).toMatchObject({status:'needs_human_approval',scope:'exchange',market:'TW',closureDate:'2026-10-23',autoPublish:false});
  expect(candidate.sha256).toMatch(/^[a-f0-9]{64}$/);
});

it.each(['某公司股票自115年10月23日起停止交易','資料下載失敗，沒有任何報價','115年10月23日集中交易市場照常交易','集中交易市場115年2月30日全日休市'])(
  'does not infer an exchange closure from %s', async text => {
    const candidate = await createNoticeCandidate({url:'https://www.twse.com.tw/staticFiles/news/fixture.pdf',text,retrievedAt:'2026-10-27T00:00:00Z'});
    expect(candidate).toMatchObject({status:'needs_human_approval',scope:'unverified',closureDate:null,autoPublish:false});
  });

it('rejects unofficial URLs and HTML masquerading as a notice', async () => {
  await expect(createNoticeCandidate({url:'https://www.twse.com.tw.evil.test/a',text:'全日休市',retrievedAt:'2026-10-27T00:00:00Z'})).rejects.toThrow();
  await expect(createNoticeCandidate({url:'https://www.twse.com.tw/news',text:'<html>Access denied</html>',retrievedAt:'2026-10-27T00:00:00Z'})).rejects.toThrow();
});
