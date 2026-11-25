import copy
import os
import unittest
from unittest.mock import patch

import headline_translation as translation


class HeadlineTranslationTests(unittest.TestCase):
    def setUp(self):
        translation._cache.clear()
        translation._day = ""
        translation._used = 0
        translation._retry_at = 0.0
        self.payload = {"stories": [{"reports": [
            {"title": "Новини України", "url": "https://example.org/ukraine"},
            {"title": "English headline", "url": "https://example.org/english"},
            {"title": "Editorial", "editorial": True},
        ]}]}

    def test_disabled_by_default(self):
        with patch.dict(os.environ, {"AZURE_TRANSLATOR_F0_KEY": ""}), patch.object(translation, "_translate") as provider:
            self.assertEqual(translation.translate_country_headlines(copy.deepcopy(self.payload)), self.payload)
            provider.assert_not_called()

    def test_translated_original_retained_and_cached(self):
        with patch.dict(os.environ, {"AZURE_TRANSLATOR_F0_KEY": "fixture"}), patch.object(
            translation, "_translate", return_value={"Новини України": ("uk", "Ukraine news"),
                                                       "English headline": ("en", "English headline")}
        ) as provider:
            first = translation.translate_country_headlines(copy.deepcopy(self.payload))
            second = translation.translate_country_headlines(copy.deepcopy(self.payload))
            self.assertEqual(first, second)
            provider.assert_called_once()
            articles = first["stories"][0]["reports"]
            self.assertEqual(articles[0]["title"], "Новини України")
            self.assertEqual(articles[0]["title_en"], "Ukraine news")
            self.assertEqual(articles[0]["url"], "https://example.org/ukraine")
            self.assertNotIn("title_en", articles[1])
            self.assertNotIn("translation_language", articles[2])

    def test_failure_does_not_replace_original_and_cools_down(self):
        with patch.dict(os.environ, {"AZURE_TRANSLATOR_F0_KEY": "fixture"}), patch.object(
            translation, "_translate", side_effect=TimeoutError
        ) as provider:
            self.assertEqual(translation.translate_country_headlines(copy.deepcopy(self.payload)), self.payload)
            self.assertEqual(translation.translate_country_headlines(copy.deepcopy(self.payload)), self.payload)
            provider.assert_called_once()

    def test_budget_blocks_provider(self):
        with patch.dict(os.environ, {"AZURE_TRANSLATOR_F0_KEY": "fixture"}), patch.object(
            translation, "DAILY_LIMIT", 1
        ), patch.object(translation, "_translate") as provider:
            self.assertEqual(translation.translate_country_headlines(copy.deepcopy(self.payload)), self.payload)
            provider.assert_not_called()


if __name__ == "__main__":
    unittest.main()
