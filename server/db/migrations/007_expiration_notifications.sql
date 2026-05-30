CREATE TABLE expiration_notification_deliveries (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL,
  cardId INTEGER NOT NULL,
  thresholdDays INTEGER NOT NULL,
  expirationDate TEXT NOT NULL,
  recipientEmail TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent')),
  providerMessageId TEXT,
  sentAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(accountId) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(cardId) REFERENCES cards(id) ON DELETE CASCADE,
  UNIQUE(accountId, cardId, thresholdDays, expirationDate, recipientEmail)
);

CREATE INDEX idx_expiration_notification_deliveries_account_sent
  ON expiration_notification_deliveries(accountId, sentAt);

CREATE INDEX idx_expiration_notification_deliveries_card
  ON expiration_notification_deliveries(accountId, cardId, thresholdDays, expirationDate);
