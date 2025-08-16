# API Documentation

The backend is a RESTful API built with Next.js API Routes. It handles all data operations for the gift registry.

---

## Admin Authentication

Endpoints for administrator login and session management.

### `POST /api/admin/login`

Logs the administrator in by setting a secure, `httpOnly` cookie.

**Request Body:**
```json
{
  "password": "your_super_secret_password"
}
```

**Responses:**
*   **`200 OK`** - On successful login.
    ```json
    {
      "success": true
    }
    ```
*   **`401 Unauthorized`** - On incorrect password.
    ```json
    {
      "success": false,
      "message": "Invalid password"
    }
    ```

### `POST /api/admin/logout`

Logs the administrator out by clearing the authentication cookie.

**Request Body:** (None)

**Response:**
*   **`200 OK`**
    ```json
    {
      "success": true
    }
    ```

### `GET /api/admin/me`

Checks if the current user has an active admin session via the cookie.

**Request Body:** (None)

**Response:**
*   **`200 OK`**
    ```json
    {
      "isAdmin": true
    }
    ```
    or
    ```json
    {
      "isAdmin": false
    }
    ```

---

## Registry Management (Admin Only)

These endpoints provide CRUD (Create, Read, Update, Delete) functionality for registry items. All endpoints in this section require an active admin session.

### `GET /api/registry/items`

Retrieves a list of all items in the registry.

**Request Body:** (None)

**Response:**
*   **`200 OK`** - Returns an array of `RegistryItem` objects.
    ```json
    [
      {
        "id": "clxfa3tqv0000u8k4h2v3c1x9",
        "name": "Fancy Espresso Machine",
        "description": "A top-of-the-line espresso machine to fuel our mornings.",
        "category": "Kitchen",
        "price": 499.99,
        "image": "/images/espresso.jpg",
        "vendorUrl": "https://example.com/espresso-machine",
        "quantity": 1,
        "isGroupGift": true,
        "purchased": false,
        "purchaserName": null,
        "amountContributed": 75.00,
        "contributors": [
          {
            "id": "clxfa4b...",
            "name": "Generous Guest",
            "amount": 75.00,
            "date": "2025-08-15T12:00:00.000Z",
            "registryItemId": "clxfa3tqv0000u8k4h2v3c1x9"
          }
        ]
      }
    ]
    ```

### `POST /api/registry/add-item`

Adds a new item to the registry.

**Request Body:**
```json
{
  "name": "Stand Mixer",
  "description": "A powerful stand mixer for all our baking adventures.",
  "category": "Kitchen",
  "price": 299.99,
  "image": "/images/mixer.jpg",
  "vendorUrl": "https://example.com/mixer",
  "quantity": 1,
  "isGroupGift": false
}
```

**Response:**
*   **`201 Created`** - Returns the newly created `RegistryItem` object.
    ```json
    {
      "id": "clxfa5z...",
      "name": "Stand Mixer",
      "description": "A powerful stand mixer for all our baking adventures.",
      "category": "Kitchen",
      "price": 299.99,
      "image": "/images/mixer.jpg",
      "vendorUrl": "https://example.com/mixer",
      "quantity": 1,
      "isGroupGift": false,
      "purchased": false,
      "purchaserName": null,
      "amountContributed": 0,
      "contributors": []
    }
    ```

### `GET /api/registry/items/{id}`

Retrieves a single registry item by its unique ID.

**Request Body:** (None)

**Response:**
*   **`200 OK`** - Returns the requested `RegistryItem` object.
    ```json
    {
      "id": "clxfa3tqv0000u8k4h2v3c1x9",
      "name": "Fancy Espresso Machine",
      "description": "A top-of-the-line espresso machine to fuel our mornings.",
      "category": "Kitchen",
      "price": 499.99,
      "image": "/images/espresso.jpg",
      "vendorUrl": "https://example.com/espresso-machine",
      "quantity": 1,
      "isGroupGift": true,
      "purchased": false,
      "purchaserName": null,
      "amountContributed": 75.00,
      "contributors": []
    }
    ```
*   **`404 Not Found`** - If no item with the given ID exists.

### `PUT /api/registry/items/{id}`

Updates an existing registry item.

**Request Body:** - An object containing the fields to update.
```json
{
  "price": 479.99,
  "description": "An updated description for the espresso machine."
}
```

**Response:**
*   **`200 OK`** - Returns the updated `RegistryItem` object.
    ```json
    {
      "id": "clxfa3tqv0000u8k4h2v3c1x9",
      "name": "Fancy Espresso Machine",
      "description": "An updated description for the espresso machine.",
      "category": "Kitchen",
      "price": 479.99,
      "image": "/images/espresso.jpg",
      "vendorUrl": "https://example.com/espresso-machine",
      "quantity": 1,
      "isGroupGift": true,
      "purchased": false,
      "purchaserName": null,
      "amountContributed": 75.00,
      "contributors": []
    }
    ```

### `DELETE /api/registry/items/{id}`

Deletes an item from the registry.

**Request Body:** (None)

**Response:**
*   **`200 OK`**
    ```json
    {
      "success": true,
      "message": "Item deleted successfully"
    }
    ```

---

## Guest Actions

Endpoints used by guests to interact with the registry.

### `POST /api/registry/contribute`

Submits a contribution towards a group gift or marks a regular item as purchased.

**Request Body:**
*   For a group gift:
    ```json
    {
      "itemId": "clxfa3tqv0000u8k4h2v3c1x9",
      "purchaserName": "Another Generous Guest",
      "amount": 50.00
    }
    ```
*   For a standard (non-group) gift:
    ```json
    {
      "itemId": "clxfa5z...",
      "purchaserName": "Thoughtful Friend"
    }
    ```

**Response:**
*   **`200 OK`** - Returns the updated `RegistryItem` object.
    ```json
    {
      "id": "clxfa3tqv0000u8k4h2v3c1x9",
      "name": "Fancy Espresso Machine",
      "description": "An updated description for the espresso machine.",
      "category": "Kitchen",
      "price": 479.99,
      "image": "/images/espresso.jpg",
      "vendorUrl": "https://example.com/espresso-machine",
      "quantity": 1,
      "isGroupGift": true,
      "purchased": false,
      "purchaserName": null,
      "amountContributed": 125.00,
      "contributors": []
    }
    ```

### `POST /api/registry/scrape`

**(Admin Only)** Scrapes a URL to pre-fill the "Add Item" form. This endpoint uses `metascraper` to pull `title`, `description`, and `image` from the target page's Open Graph or metadata tags.

**Request Body:**
```json
{
  "url": "https://www.amazon.com/some-product-link"
}
```

**Response:**
*   **`200 OK`** - Returns the scraped data.
    ```json
    {
      "name": "Product Title from Amazon",
      "description": "Product description scraped from the page.",
      "image": "https://m.media-amazon.com/images/I/some-image.jpg"
    }
    ```
*   **`400 Bad Request`** - If the URL is invalid or scraping fails.
