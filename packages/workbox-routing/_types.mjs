/*
 Copyright 2016 Google Inc. All Rights Reserved.
 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

import './_version.mjs';

/**
 * The "match" callback is used to determine if a `Route` should apply for a
 * particular URL. When matching occurs in response to a fetch event from the
 * client, the `event` and `request` objects are supplied in addition to the
 * URL. However, since the match callback can be invoked outside of a fetch
 * event, matching logic should not assume the `event` or `request` objects
 * will always be available (unlike URL, which is always available).
 * If the match callback returns a truthy value, the matching route's
 * [handler callback]{@link workbox.routing.Route~handlerCallback} will be
 * invoked immediately. If the value returned is a non-empty array or object,
 * that value will be set on the handler's `context.params` argument.
 *
 * @callback Route~matchCallback
 * @param {Object} context
 * @param {URL} context.url The request's URL.
 * @param {FetchEvent} [context.request] The corresponding request,
 *     if available.
 * @param {FetchEvent} [context.event] The corresponding event that triggered
 *     the request, if available.
 * @return {*} To signify a match, return a truthy value.
 *
 * @memberof workbox.routing
 */

/**
 * The "handler" callback is invoked whenever a `Router` matches a URL to a
 * `Route` via its [match]{@link workbox.routing.Route~handlerCallback}
 * callback. This callback should return a Promise that resolves with a
 * `Response`.
 *
 * If a non-empty array or object is returned by the
 * [match callback]{@link workbox.routing.Route~matchCallback} it
 * will be passed in as the handler's `context.params` argument.
 *
 * @callback Route~handlerCallback
 * @param {Object} context
 * @param {URL} context.url The URL that matched.
 * @param {FetchEvent} [context.request] The corresponding request,
 *     if available.
 * @param {FetchEvent} [context.event] The corresponding event that triggered
 *     the request, if available.
 * @param {Object} [context.params] Array or Object parameters returned by the
 *     Route's [match callback]{@link workbox.routing.Route~matchCallback}.
 *     This will be undefined if an empty array or object were returned.
 * @return {Promise<Response>} The response that will fulfill the request.
 *
 * @memberof workbox.routing
 */
