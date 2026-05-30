UPDATE cards
SET expirationDate = (
  SELECT printf('%04d-%02d-01', CAST(yearField.displayHint AS INTEGER), CAST(monthField.displayHint AS INTEGER))
  FROM card_credential_fields AS monthField
  JOIN card_credential_fields AS yearField
    ON yearField.accountId = monthField.accountId
   AND yearField.cardId = monthField.cardId
   AND yearField.fieldKind = 'expiration_year'
  WHERE monthField.accountId = cards.accountId
    AND monthField.cardId = cards.id
    AND monthField.fieldKind = 'expiration_month'
    AND CAST(monthField.displayHint AS INTEGER) BETWEEN 1 AND 12
    AND CAST(yearField.displayHint AS INTEGER) BETWEEN 2000 AND 2200
  LIMIT 1
)
WHERE expirationDate IS NULL
  AND EXISTS (
    SELECT 1
    FROM card_credential_fields AS monthField
    JOIN card_credential_fields AS yearField
      ON yearField.accountId = monthField.accountId
     AND yearField.cardId = monthField.cardId
     AND yearField.fieldKind = 'expiration_year'
    WHERE monthField.accountId = cards.accountId
      AND monthField.cardId = cards.id
      AND monthField.fieldKind = 'expiration_month'
      AND CAST(monthField.displayHint AS INTEGER) BETWEEN 1 AND 12
      AND CAST(yearField.displayHint AS INTEGER) BETWEEN 2000 AND 2200
  );
