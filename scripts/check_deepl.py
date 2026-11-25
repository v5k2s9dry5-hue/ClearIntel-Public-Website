"""Opt-in DeepL Developer smoke test; never sends real news or personal data.

Run manually in a private environment containing DEEPL_API_KEY.
Uses only a fixed synthetic Ukrainian phrase and the free API endpoint.
"""
import json
import os
from urllib.request import Request, urlopen


def test_translation():
    key = os.environ.get("DEEPL_API_KEY", "").strip()
    if not key or not key.endswith(":fx"):
        raise ValueError("Configure a free DeepL API key privately.")
    request = Request(
        "https://api-free.deepl.com/v2/translate",
        data=json.dumps({"text": ["Вітаємо у світі перекладу!"], "target_lang": "EN-GB"}).encode(),
        headers={"Authorization": "DeepL-Auth-Key " + key,
                 "Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=10) as response:
        payload = json.loads(response.read(16384))
    result = payload["translations"][0]
    if not isinstance(result["text"], str) or not result["text"].strip():
        raise ValueError("Invalid translation response.")
    return result["text"]


if __name__ == "__main__":
    try:
        print("DeepL test passed:", test_translation())
    except Exception:
        print("DeepL test unavailable. Check the free key and account allowance.")
        raise SystemExit(1)
