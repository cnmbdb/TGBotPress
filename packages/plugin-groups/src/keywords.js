const recommendedGroupAdKeywords = [
  "\u535A\u5F69",
  "\u8D4C\u573A",
  "\u4E0B\u6CE8",
  "\u5305\u8D62",
  "\u5237\u5355",
  "\u8DD1\u5206",
  "\u6D17\u94B1",
  "\u7A7A\u6295\u7FA4",
  "\u8D44\u91D1\u76D8",
  "\u9AD8\u85AA\u517C\u804C",
  "\u65E5\u8D5A",
  "\u7A33\u8D5A",
  "\u4FDD\u672C\u6536\u76CA",
  "\u4EE3\u5F00\u53D1\u7968",
  "\u51FA\u552E\u8D26\u53F7",
  "\u6536\u8D2D\u8D26\u53F7",
  "\u514D\u8D39\u7A7A\u6295",
  "\u62C5\u4FDD\u4EA4\u6613",
  "\u65E0\u62BC\u8D37\u6B3E",
  "\u88F8\u804A",
  "\u8272\u7C89",
  "\u76D8\u53E3",
  "\u5A31\u4E50\u57CE",
  "\u4EE3\u7406\u62DB\u5546",
  "\u6E20\u9053\u5408\u4F5C",
  "\u4F4E\u4EF7\u51FA\u552E",
  "\u9650\u65F6\u4F18\u60E0",
  "\u514D\u8D39\u9886\u53D6",
  "\u52A0\u6211\u54A8\u8BE2",
  "\u79C1\u804A\u54A8\u8BE2",
  "\u8054\u7CFB\u6211",
  "\u627F\u5151",
  "\u4EE3\u4ED8",
  "\u6362\u6C47",
  "\u5F15\u6D41",
  "\u63A8\u5E7F",
  "\u62DB\u8058",
  "\u5E7F\u544A\u5408\u4F5C",
  "\u5E7F\u544A\u4F4D",
  "\u5546\u52A1\u5408\u4F5C",
  "\u9879\u76EE\u63A8\u5E7F",
  "\u8D44\u6E90\u5BF9\u63A5",
  "\u62DB\u4EE3\u7406",
  "\u52A0\u7FA4",
  "\u8FDB\u7FA4",
  "\u7FA4\u53D1",
  "\u62C9\u4EBA",
  "\u4EE3\u6536",
  "\u4EE3\u5145",
  "\u6536u",
  "\u51FAu",
  "\u5E01\u5546",
  "\u7FA4\u6F14\u62DB\u52DF",
  "\u517C\u804C\u65E5\u7ED3",
  "\u5237\u5355\u8FD4\u5229",
  "\u9879\u76EE\u62DB\u5546",
  "\u9879\u76EE\u8FD4\u4F63\u76D8",
  "\u9AD8\u6536\u76CA\u7406\u8D22",
  "USDT\u627F\u5151",
  "\u8D26\u53F7\u4E70\u5356",
  "\u5F15\u6D41\u83B7\u5BA2",
  "\u8D44\u6E90\u5BF9\u63A5\u7FA4",
  "\u8D37\u6B3E\u4E0B\u6B3E",
  "\u68CB\u724C\u535A\u5F69",
  "\u76D8\u53E3\u4EE3\u7406",
  "\u865A\u62DF\u5E01\u642C\u7816",
  "\u8DD1\u5206\u8F66\u961F",
  "\u5361\u5546\u6599\u5546",
  "\u8BDD\u8D39\u6162\u5145",
  "\u793C\u54C1\u5361\u56DE\u6536",
  "\u56DE\u6536\u793C\u54C1\u5361",
  "\u62C5\u4FDD\u6362\u6C47",
  "\u7A7A\u6295\u62C9\u65B0",
  "\u76F4\u64AD\u8272\u7C89",
  "\u88F8\u804A\u6572\u8BC8",
  "\u8BC1\u4EF6\u529E\u7406",
  "\u514D\u8D39\u9886\u5E01",
  "\u52A0\u7FA4\u9886\u798F\u5229",
  "\u79C1\u804A\u62A5\u4EF7",
  "\u8054\u7CFB\u98DE\u673A\u5BA2\u670D",
  "\u62DB\u4EE3\u7406\u8FD4\u4F63",
  "\u4EE3\u6536\u4EE3\u4ED8",
  "\u515C\u6BD4\u8138\u5E72\u51C0"
];
function splitModerationKeywords(value) {
  return String(value ?? "").split(/[,，\r\n]+/u).map((keyword) => keyword.trim()).filter(Boolean);
}
function uniqueKeywords(values) {
  const seen = /* @__PURE__ */ new Set();
  return values.filter((keyword) => {
    const normalized = keyword.toLocaleLowerCase("und");
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}
function customGroupAdKeywords(groupKeywords, sharedKeywords) {
  const managed = new Set([
    ...recommendedGroupAdKeywords,
    ...splitModerationKeywords(sharedKeywords)
  ].map((keyword) => keyword.toLocaleLowerCase("und")));
  return uniqueKeywords(splitModerationKeywords(groupKeywords).filter((keyword) => !managed.has(keyword.toLocaleLowerCase("und"))));
}
function effectiveGroupAdKeywords(groupKeywords, sharedKeywords, autoUpload, autoSync) {
  const includeRecommended = autoUpload == null || autoUpload;
  const includeShared = autoSync == null || autoSync;
  return uniqueKeywords([
    ...customGroupAdKeywords(groupKeywords, sharedKeywords),
    ...includeRecommended ? [...recommendedGroupAdKeywords] : [],
    ...includeShared ? splitModerationKeywords(sharedKeywords) : []
  ]);
}
export {
  customGroupAdKeywords,
  effectiveGroupAdKeywords,
  recommendedGroupAdKeywords,
  splitModerationKeywords
};
