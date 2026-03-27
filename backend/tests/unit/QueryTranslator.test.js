import QueryTranslator from "../../src/modules/QueryTranslator.js";

describe("QueryTranslator", () => {
  let translator;

  beforeEach(() => {
    translator = new QueryTranslator();
  });

  describe("toEmbase", () => {
    test("should convert MeSH to Emtree explode", () => {
      const result = translator.toEmbase('"Heart Failure"[Mesh]');
      expect(result).toBe("exp Heart Failure/");
    });

    test("should convert [tiab] to .ti,ab.", () => {
      const result = translator.toEmbase('"pain relief"[tiab]');
      expect(result).toBe("pain relief.ti,ab.");
    });

    test("should handle combined query", () => {
      const query = '("Knee"[Mesh] OR knee[tiab]) AND "therapy"[tiab]';
      const result = translator.toEmbase(query);
      expect(result).toContain("exp Knee/");
      expect(result).toContain(".ti,ab.");
      expect(result).toContain("AND");
    });
  });

  describe("toCochrane", () => {
    test("should convert MeSH to [mh] format", () => {
      const result = translator.toCochrane('"Heart Failure"[Mesh]');
      expect(result).toBe('[mh "Heart Failure"]');
    });

    test("should convert [tiab] to :ti,ab format", () => {
      const result = translator.toCochrane('"pain relief"[tiab]');
      expect(result).toBe('"pain relief":ti,ab');
    });

    test("should preserve truncation with *", () => {
      const result = translator.toCochrane("therap*[tiab]");
      expect(result).toBe("therap*:ti,ab");
    });
  });

  describe("toWos", () => {
    test("should convert MeSH to TS= topic search", () => {
      const result = translator.toWos('"Heart Failure"[Mesh]');
      expect(result).toBe('TS="Heart Failure"');
    });

    test("should expand [tiab] to TI= OR AB=", () => {
      const result = translator.toWos('"pain"[tiab]');
      expect(result).toBe('(TI="pain" OR AB="pain")');
    });
  });

  describe("toScopus", () => {
    test("should convert MeSH to INDEXTERMS()", () => {
      const result = translator.toScopus('"Heart Failure"[Mesh]');
      expect(result).toBe('INDEXTERMS("Heart Failure")');
    });

    test("should convert [tiab] to TITLE-ABS()", () => {
      const result = translator.toScopus('"pain"[tiab]');
      expect(result).toBe('TITLE-ABS("pain")');
    });

    test("should convert standalone NOT to AND NOT", () => {
      const result = translator.toScopus("(A[tiab]) NOT (B[tiab])");
      expect(result).toContain("AND NOT");
    });

    test("should not convert NOT inside quoted strings", () => {
      // NOT inside field tags should be handled by earlier replacements
      const result = translator.toScopus('"do NOT use"[tiab]');
      // The term "do NOT use" is inside quotes and gets converted to TITLE-ABS
      expect(result).toBe('TITLE-ABS("do NOT use")');
    });
  });

  describe("translateAll", () => {
    test("should return all database formats", () => {
      const query = '"Knee"[Mesh]';
      const result = translator.translateAll(query);

      expect(result).toHaveProperty("pubmed");
      expect(result).toHaveProperty("embase");
      expect(result).toHaveProperty("cochrane");
      expect(result).toHaveProperty("wos");
      expect(result).toHaveProperty("scopus");
      expect(result.pubmed).toBe(query);
    });
  });

  describe("_replaceOutsideQuotes", () => {
    test("should only replace outside quoted strings", () => {
      const result = translator._replaceOutsideQuotes(
        'NOT "NOT inside" NOT',
        /\bNOT\b/g,
        "AND NOT",
      );
      expect(result).toBe('AND NOT "NOT inside" AND NOT');
    });
  });

  describe("getDatabaseInfo", () => {
    test("should return all 5 databases", () => {
      const dbs = QueryTranslator.getDatabaseInfo();
      expect(dbs).toHaveLength(5);
      expect(dbs.map((d) => d.id)).toEqual([
        "pubmed",
        "embase",
        "cochrane",
        "wos",
        "scopus",
      ]);
    });

    test("only pubmed should be validatable", () => {
      const dbs = QueryTranslator.getDatabaseInfo();
      const validatable = dbs.filter((d) => d.canValidate);
      expect(validatable).toHaveLength(1);
      expect(validatable[0].id).toBe("pubmed");
    });
  });
});
