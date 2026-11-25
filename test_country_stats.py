import unittest
from unittest.mock import patch
from collections import OrderedDict
from country_stats import parse_indicators, stats, _fetch
from urllib.error import HTTPError
class StatsTests(unittest.TestCase):
    def test_validate_country_indicator_date_and_value(self):
        def row(code, indicator, date, value):
            return {"country":{"id":code},"indicator":{"id":indicator},"date":date,"value":value}
        result=parse_indicators([{},[
            row("GB","SP.POP.TOTL","2022",100),
            row("GB","SP.POP.TOTL","2023",200),
            row("US","SP.POP.TOTL","2024",999),
            row("GB","NY.GDP.MKTP.CD","2023",float("nan")),
            row("GB","AG.LND.TOTL.K2","2023",None),
        ]],"GB")
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]["value"],200)
        self.assertEqual(result[0]["year"],"2023")
    def test_negative_growth_is_valid(self):
        result=parse_indicators([{},[{"country":{"id":"GB"},"indicator":{"id":"NY.GDP.MKTP.KD.ZG"},"date":"2023","value":-1.2}]],"GB")
        self.assertEqual(result[0]["value"],-1.2)
    def test_empty_and_invalid(self):
        self.assertEqual(parse_indicators([{},[]],"GB"),[])
        with self.assertRaises(ValueError):
            parse_indicators({"unexpected":True},"GB")
    def test_cache(self):
        with patch("country_stats._cache",OrderedDict()),patch("country_stats._fetch",return_value=[]) as provider:
            self.assertEqual(stats("GB")["status"],"no-data")
            self.assertEqual(stats("GB")["status"],"no-data")
            provider.assert_called_once()

    def test_rejected_recent_query_falls_back_once(self):
        with patch("country_stats._read",side_effect=[ValueError("Invalid indicator response"),[]]) as read:
            self.assertEqual(_fetch("GB"),[])
            self.assertEqual(read.call_count,2)
            self.assertIn("date",read.call_args.args[1])
    def test_rate_limit_is_not_retried(self):
        error=HTTPError("https://api.worldbank.org",429,"Too many requests",{},None)
        with patch("country_stats._read",side_effect=error) as read:
            with self.assertRaises(HTTPError):
                _fetch("GB")
            read.assert_called_once()


    def test_development_indicators_validate_ranges_and_preserve_years(self):
        from country_stats import INDICATORS
        def row(indicator, value, date='2023'):
            return {"country":{"id":"GB"},"indicator":{"id":indicator},"date":date,"value":value}
        rows = parse_indicators([{}, [
            row("NY.GDP.PCAP.CD", 49000, '2024'),
            row("SL.UEM.TOTL.ZS", 4.5),
            row("SL.UEM.TOTL.ZS", 110, '2024'),
            row("SP.DYN.LE00.IN", 81),
            row("SP.DYN.LE00.IN", 150, '2024'),
            row("IT.NET.USER.ZS", 97.2),
            row("IT.NET.USER.ZS", 101, '2024'),
        ]], "GB")
        self.assertEqual(len(INDICATORS), 9)
        self.assertEqual([r["value"] for r in rows], [49000, 4.5, 81, 97.2])
        self.assertEqual(rows[0]["year"], "2024")
        self.assertEqual(rows[-1]["year"], "2023")
        self.assertIn("ILO modelled estimate", rows[1]["label"])
