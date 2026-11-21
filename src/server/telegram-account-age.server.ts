const anchors: Array<[number, string]> = [
  [0,'2013-08-14'],[2768409,'2013-11-01'],[7679610,'2013-12-31'],[15835244,'2014-02-20'],[38015510,'2014-03-01'],[54845238,'2014-09-20'],[101260938,'2015-03-06'],[157242073,'2015-11-06'],[222021233,'2016-06-08'],[297621225,'2016-12-16'],[400169472,'2017-07-31'],[805158066,'2019-07-15'],[1974255900,'2021-10-12'],[5031711230,'2021-12-06'],[5177789190,'2022-01-24'],[5288930461,'2022-01-27'],[5396515972,'2022-04-21'],[5505809357,'2022-05-27'],[5598262640,'2022-06-11'],[5694365966,'2022-08-28'],[5765259845,'2022-10-30'],[5931294587,'2022-11-19'],[5983753471,'2022-12-23'],[6271031786,'2023-02-12'],[6326011828,'2023-07-07'],[6523424924,'2023-08-02'],[6684986493,'2023-09-25'],[6827058708,'2023-11-06'],[6947316117,'2023-12-15'],[7002435197,'2024-04-06'],[7104310277,'2024-04-19'],[7242296450,'2024-05-29'],[7409259451,'2024-06-20'],[7458668365,'2024-08-02'],[7832006200,'2024-09-19'],[8173852075,'2025-02-21'],[8238766847,'2025-07-31'],[8369442459,'2025-08-08'],[8461579295,'2025-09-11'],[8559682245,'2025-11-11'],
]
const timeAnchors = anchors.map(([id, date]) => [id, Date.parse(date + 'T00:00:00Z')] as const)

/** Telegram does not expose registration time; this is the same UID-based estimate used by the PHP backend. */
export function estimateTelegramAccountAgeSeconds(userId: number, nowSeconds = Math.floor(Date.now() / 1000)): number | null {
  if (!Number.isSafeInteger(userId) || userId <= 0) return null
  const nowMs = nowSeconds * 1000
  const first = timeAnchors[0]
  let createdMs: number
  if (userId <= first[0]) createdMs = first[1]
  else {
    let left = timeAnchors[timeAnchors.length - 2], right = timeAnchors[timeAnchors.length - 1]
    for (let index = 0; index < timeAnchors.length - 1; index++) {
      if (userId <= timeAnchors[index + 1][0]) { left = timeAnchors[index]; right = timeAnchors[index + 1]; break }
    }
    const ratio = (userId - left[0]) / (right[0] - left[0])
    createdMs = Math.round(left[1] + (right[1] - left[1]) * ratio)
  }
  return Math.max(0, nowSeconds - Math.floor(Math.min(createdMs, nowMs) / 1000))
}
