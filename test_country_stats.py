import unittest
from unittest.mock import patch
from collections import OrderedDict
from country_stats import parse_indicators, stats
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
    def test_empty_and_invalid(self):
        self.assertEqual(parse_indicators([{},[]],"GB"),[])
        with self.assertRaises(ValueError):
            parse_indicators({"unexpected":True},"GB")
    def test_cache(self):
        with patch("country_stats._cache",OrderedDict()),patch("country_stats._fetch",return_value=[]) as provider:
            self.assertEqual(stats("GB")["status"],"no-data")
            self.assertEqual(stats("GB")["status"],"no-data")
            provider.assert_called_once()
