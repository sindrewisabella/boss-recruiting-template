import copy
import json
import unittest
from pathlib import Path
from boss_template import evaluate, validate, load_profile

ROOT = Path(__file__).resolve().parents[1]


class MatchingTests(unittest.TestCase):
    def setUp(self):
        self.ops = json.loads((ROOT / "profiles/ops.example.json").read_text())
        self.people = json.loads((ROOT / "examples/candidates.synthetic.json").read_text())

    def test_missing_first_degree_not_inferred_from_masters(self):
        result = evaluate(self.ops, self.people)
        self.assertEqual([x["decision"] for x in result["results"]],
                         ["eligible", "needs_review", "rejected", "rejected"])
        self.assertEqual(result["liveActions"], 0)

    def test_change_role_without_changing_engine(self):
        profile = json.loads((ROOT / "profiles/test.synthetic.json").read_text())
        result = evaluate(profile, self.people)
        self.assertEqual([x["candidateKey"] for x in result["results"] if x["decision"] == "eligible"],
                         ["synthetic-D"])
        self.assertNotEqual(validate(profile), validate(self.ops))

    def test_empty_evidence_and_contradictions_require_review(self):
        for edit in ({"evidence": ""}, {"contradictory": True}, {"observedAt": "bad-time"}):
            people = copy.deepcopy(self.people[:1])
            people[0]["facts"]["firstDegree"].update(edit)
            self.assertEqual(evaluate(self.ops, people)["results"][0]["decision"], "needs_review")

    def test_duplicate_identity_blocks_input(self):
        with self.assertRaises(ValueError):
            evaluate(self.ops, [self.people[0], self.people[0]])

    def test_unknown_operator_is_not_ignored(self):
        self.ops["must"][0]["operator"] = "approximate"
        with self.assertRaises(ValueError):
            evaluate(self.ops, self.people)

    def test_true_reject_overrides_passed_must(self):
        self.ops["reject"] = [{"field": "firstDegree", "operator": "equals", "value": "本科"}]
        self.assertEqual(evaluate(self.ops, self.people[:1])["results"][0]["decision"], "rejected")

    def test_unified_keywords_do_not_require_old_education_rule(self):
        profile = json.loads((ROOT / 'profiles/growth-unified.json').read_text())
        person = {'candidateKey':'synthetic-keyword', 'facts':{'visibleProfessionalText':{
            'value':'开发 Agent 工具', 'evidence':'开发 Agent 工具', 'source':'合成资料',
            'observedAt':'2026-10-09T15:00:00+08:00'}}}
        row=evaluate(profile,[person])['results'][0]
        self.assertEqual(row['decision'],'eligible')
        self.assertIn('Agent',row['checks'][0]['matchedKeywords'])
        self.assertNotIn('firstDegree',person['facts'])

    def test_same_rules_for_two_real_job_bindings(self):
        a=load_profile(ROOT / 'profiles/growth-unified-shenzhen.json')
        b=load_profile(ROOT / 'profiles/growth-unified-xiamen.json')
        self.assertEqual(validate(a),validate(b))

    def test_storage_is_not_rag_and_chinese_adjacent_agent_matches(self):
        from boss_template import keyword_hits
        self.assertEqual(keyword_hits('Storage manager',['RAG','Agent']),[])
        self.assertEqual(keyword_hits('Agent后端、RAG系统',['RAG','Agent']),['RAG','Agent'])


if __name__ == "__main__":
    unittest.main()
