# API Documentation

The backend is a RESTful API built with Next.js Route Handlers. It handles all data operations for the gift registry.

<!-- API_DOCS_START -->

### `GET /api/admin/[entity]/[id]`


### `PUT /api/admin/[entity]/[id]`

**Request Body:**

Any valid JSON object.

### `DELETE /api/admin/[entity]/[id]`


### `GET /api/admin/[entity]`


### `POST /api/admin/[entity]`

**Request Body:**

Any valid JSON object.

### `PUT /api/admin/[entity]`

**Request Body:**

Any valid JSON object.

### `GET /api/admin/features`


### `PUT /api/admin/features`

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `features` | `any` | Yes |  |


### `POST /api/admin/login`

**Request Body:**

Any valid JSON object.

### `POST /api/admin/logout`

**Request Body:**

Any valid JSON object.

### `GET /api/admin/maintenance/export`


### `POST /api/admin/maintenance/import`

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `appConfig` | `any` | No |  |
| `contentNode` | `any` | No |  |
| `weddingPartyMember` | `any` | No |  |
| `attraction` | `any` | No |  |
| `registryItem` | `any` | No |  |
| `contributor` | `any` | No |  |


### `GET /api/admin/me`


### `GET /api/admin/settings`


### `PUT /api/admin/settings`

**Request Body:**

A numeric coordinate or placeholder string.

### `POST /api/admin/upload`

**Request Body:**

Any valid JSON object.

### `POST /api/admin/versions/[id]/restore`

**Request Body:**

A numeric coordinate or placeholder string.

### `GET /api/admin/versions`


### `POST /api/registry/add-item`

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Item name is required and must be under 255 characters. |
| `price` | `number` | Yes | Price must be a positive number. |
| `quantity` | `number` | Yes | Quantity must be a positive integer. |
| `category` | `string` | Yes | Category is required and must be under 255 characters. |
| `description` | `string | number | boolean` | No | Description must be under 2000 characters. |
| `image` | `string | number | boolean` | No | Image URL must be under 2000 characters. |
| `vendorUrl` | `string | number | boolean` | No | Vendor URL must be under 2000 characters. |
| `isGroupGift` | `string | number | boolean` | No |  |


### `POST /api/registry/contribute`

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `itemId` | `string` | Yes | Missing or invalid itemId. |
| `name` | `string` | Yes | Name is required and must be under 100 characters. |
| `amount` | `number` | Yes | Contribution amount must be a positive number. |


### `GET /api/registry/items/[id]`


### `PUT /api/registry/items/[id]`

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Item name is required and must be under 255 characters. |
| `price` | `number` | Yes | Price must be a positive number. |
| `quantity` | `number` | Yes | Quantity must be a positive integer. |
| `category` | `string` | Yes | Category is required and must be under 255 characters. |
| `description` | `string | number | boolean` | No | Description must be under 2000 characters. |
| `image` | `string | number | boolean` | No | Image URL must be under 2000 characters. |
| `vendorUrl` | `string | number | boolean` | No | Vendor URL must be under 2000 characters. |
| `isGroupGift` | `string | number | boolean` | No |  |


### `DELETE /api/registry/items/[id]`


### `GET /api/registry/items`


### `POST /api/registry/scrape`

**Request Body:**

Any valid JSON object.

### `GET /api/weather`



<!-- API_DOCS_END -->
